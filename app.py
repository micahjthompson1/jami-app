from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
from flask_cors import CORS
import re
import requests
import torch
from transformers import MT5ForConditionalGeneration, MT5Tokenizer
from torch.nn.modules.lazy import LazyModuleMixin
import logging
import gc
from contextlib import contextmanager
from functools import lru_cache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
gc.enable()

def force_garbage_collection():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

class LazyTensor:
    def __init__(self, file_path):
        self.file_path = file_path
        self.tensor = None

    def materialize(self):
        if self.tensor is None:
            self.tensor = torch.load(self.file_path)
        return self.tensor

    def __getattr__(self, name):
        return getattr(self.materialize(), name)

class LazyMT5(LazyModuleMixin, MT5ForConditionalGeneration):
    def __init__(self, config):
        super().__init__(config)

class ModelManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._model = None
            cls._instance._tokenizer = None
        return cls._instance

    @lru_cache(maxsize=1)
    def get_model_and_tokenizer(self):
        if self._model is None or self._tokenizer is None:
            self._model = LazyMT5.from_pretrained("google/mt5-small", low_cpu_mem_usage=True)
            self._tokenizer = MT5Tokenizer.from_pretrained("google/mt5-small", use_fast=True)
            self._model = self._model.half().to('cpu')
        return self._model, self._tokenizer

model_manager = ModelManager()

@contextmanager
def model_context():
    model, tokenizer = model_manager.get_model_and_tokenizer()
    try:
        yield model, tokenizer
    finally:
        force_garbage_collection()

app = Flask(__name__)
CORS(app)

# Database configuration with SSL
base_connection_string = os.environ.get('DB_CONNECTION_STRING')
ssl_config = "&ssl_ca=/etc/ssl/cert.pem"
app.config['SQLALCHEMY_DATABASE_URI'] = base_connection_string + ssl_config
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Celery
celery = Celery(app.name, broker=os.environ.get('REDIS_URL', 'redis://localhost:6379/0'))
celery.conf.update(app.config)

celery.conf.update(
    worker_max_tasks_per_child=100,
    worker_max_memory_per_child=1000000  # 1GB
)

class CommonFrenchWord(db.Model):
    __tablename__ = 'common_words_french_freq50'
    id = db.Column(db.Integer, primary_key=True)
    word = db.Column(db.String(255), unique=True, nullable=False)

@app.route('/proxy')
def proxy():
    url = request.args.get('url')
    try:
        response = requests.get(url)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        logger.error(f"Error in proxy: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/match-words', methods=['POST'])
def match_words():
    try:
        lyrics = request.json.get('lyrics')
        if not lyrics:
            return jsonify({'error': 'Lyrics are required'}), 400
        words = set(re.findall(r'\w+', lyrics.lower()))
        matching_words = db.session.query(CommonFrenchWord.word).filter(
            CommonFrenchWord.word.in_(words)
        ).order_by(CommonFrenchWord.id).limit(10).all()
        result = [word[0] for word in matching_words]
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in match_words: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        db.session.close()

def process_context_generation(lyric):
    with model_context() as (model, tokenizer):
        input_text = f"Explain the meaning and context of this French lyric in English: {lyric}"
        input_ids = tokenizer.encode(input_text, return_tensors="pt")
        with torch.no_grad():
            output = model.generate(input_ids, max_length=150, num_return_sequences=1)
        context = tokenizer.decode(output[0], skip_special_tokens=True)
    return context

@celery.task
def generate_context_task(lyric):
    return process_context_generation(lyric)

@app.route('/api/generate-context', methods=['POST'])
def generate_context():
    try:
        lyric = request.json.get('lyric')
        if not lyric:
            return jsonify({'error': 'Lyric is required'}), 400
        task = generate_context_task.delay(lyric)
        return jsonify({'task_id': task.id}), 202
    except Exception as e:
        logger.error(f"Error in generate_context: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/get-context-result/', methods=['GET'])
def get_context_result():
    task_id = request.args.get('task_id')
    if not task_id:
        return jsonify({'error': 'Task ID is required'}), 400
    
    task = generate_context_task.AsyncResult(task_id)
    if task.state == 'PENDING':
        return jsonify({'status': 'pending'}), 202
    elif task.state != 'FAILURE':
        return jsonify({'status': 'completed', 'context': task.result})
    else:
        return jsonify({'status': 'failed', 'error': str(task.result)}), 500

@app.teardown_appcontext
def shutdown_session(exception=None):
    db.session.remove()

@app.after_request
def after_request(response):
    force_garbage_collection()
    return response

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
