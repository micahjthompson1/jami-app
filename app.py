from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_caching import Cache
from celery import Celery
import os
from flask_cors import CORS
import re 
import requests
import torch
from transformers import MT5ForConditionalGeneration, MT5Tokenizer
from torch.nn.modules.lazy import LazyModuleMixin
import logging
from queue import Queue
from threading import Thread

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

app = Flask(__name__)
CORS(app)

# Database configuration with SSL
base_connection_string = os.environ.get('DB_CONNECTION_STRING')
ssl_config = "&ssl_ca=/etc/ssl/cert.pem"

app.config['SQLALCHEMY_DATABASE_URI'] = base_connection_string + ssl_config
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Rate limiter
limiter = Limiter(app, key_func=get_remote_address, default_limits=["200 per day", "50 per hour"])

# Caching
cache = Cache(app, config={'CACHE_TYPE': 'simple'})

# Celery
celery = Celery(app.name, broker=os.environ.get('REDIS_URL', 'redis://localhost:6379/0'))
celery.conf.update(app.config)

# Model queue
model_queue = Queue(maxsize=1)

# Lazy-loaded mT5 model and tokenizer
model = None
tokenizer = None

def load_model_and_tokenizer():
    global model, tokenizer
    if model is None or tokenizer is None:
        model = LazyMT5.from_pretrained("google/mt5-small")
        tokenizer = MT5Tokenizer.from_pretrained("google/mt5-small")
        model = model.half()  # Convert to float16 for memory efficiency
    model_queue.put((model, tokenizer))

load_model_and_tokenizer()

class CommonFrenchWord(db.Model):
    __tablename__ = 'common_words_french_freq50'
    id = db.Column(db.Integer, primary_key=True)
    word = db.Column(db.String(255), unique=True, nullable=False)

@app.route('/proxy')
@limiter.limit("100 per minute")
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
@limiter.limit("50 per minute")
@cache.memoize(timeout=3600)
def match_words():
    try:
        lyrics = request.json.get('lyrics')
        if not lyrics:
            return jsonify({'error': 'Lyrics are required'}), 400

        words = set(re.findall(r'\w+', lyrics.lower()))
        matching_words = CommonFrenchWord.query.with_entities(CommonFrenchWord.word).filter(CommonFrenchWord.word.in_(words)).all()
        result = [word[0] for word in matching_words]
        return jsonify(result)

    except Exception as e:
        logger.error(f"Error in match_words: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

def process_context_generation(lyric):
    model, tokenizer = model_queue.get()
    try:
        input_text = f"Translate and explain the context of this French lyric: {lyric}"
        input_ids = tokenizer.encode(input_text, return_tensors="pt")

        with torch.no_grad():
            output = model.generate(input_ids, max_length=150, num_return_sequences=1)

        context = tokenizer.decode(output[0], skip_special_tokens=True)
        return context
    finally:
        model_queue.put((model, tokenizer))

@celery.task
def generate_context_task(lyric):
    return process_context_generation(lyric)

@app.route('/api/generate-context', methods=['POST'])
@limiter.limit("10 per minute")
@cache.memoize(timeout=3600)
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

@app.route('/api/get-context-result/<task_id>', methods=['GET'])
def get_context_result(task_id):
    task = generate_context_task.AsyncResult(task_id)
    if task.state == 'PENDING':
        return jsonify({'status': 'pending'}), 202
    elif task.state != 'FAILURE':
        return jsonify({'status': 'completed', 'context': task.result})
    else:
        return jsonify({'status': 'failed', 'error': str(task.result)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
