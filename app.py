from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
from flask_cors import CORS
import re
import requests
import torch
from transformers import MT5ForConditionalGeneration, MT5Tokenizer
import logging
import gc
import ssl

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Database configuration with SSL
base_connection_string = os.environ.get('DB_CONNECTION_STRING')
ssl_config = "&ssl_ca=/etc/ssl/cert.pem"
app.config['SQLALCHEMY_DATABASE_URI'] = base_connection_string + ssl_config
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Celery
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

celery = Celery(app.name, broker=REDIS_URL)
celery.conf.update(app.config)
celery.conf.update(
    broker_url=REDIS_URL,
    result_backend=REDIS_URL,
    worker_max_tasks_per_child=100,
    worker_max_memory_per_child=1000000,  # 1GB
    worker_concurrency=1  # This sets CELERYD_CONCURRENCY to 1
)

if REDIS_URL.startswith('rediss://'):
    celery.conf.broker_use_ssl = {
        'ssl_cert_reqs': ssl.CERT_NONE
    }
    celery.conf.redis_backend_use_ssl = {
        'ssl_cert_reqs': ssl.CERT_NONE
    }

class CommonFrenchWord(db.Model):
    __tablename__ = 'common_words_french_freq50'
    id = db.Column(db.Integer, primary_key=True)
    word = db.Column(db.String(255), unique=True, nullable=False)

# Model initialization
model = None
tokenizer = None
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

def initialize_model():
    global model, tokenizer
    if model is None:
        model = MT5ForConditionalGeneration.from_pretrained("google/mt5-small")
        tokenizer = MT5Tokenizer.from_pretrained("google/mt5-small")
        model = model.to(device)

# Call this function when your app starts
initialize_model()

def process_context_generation(lyric):
    input_text = f"translate French to English: {lyric}"
    inputs = tokenizer(input_text, return_tensors="pt", padding=True).to(device)
    
    with torch.no_grad():
        outputs = model.generate(**inputs, max_length=150, num_return_sequences=1)
    
    context = tokenizer.decode(outputs[0], skip_special_tokens=True)
    
    del outputs
    gc.collect()
    torch.cuda.empty_cache()
    
    return context

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

@celery.task
def generate_context_task(lyric):
    initialize_model()  # Ensure model is loaded
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
    
    try:
        task = generate_context_task.AsyncResult(task_id)
        if task.state == 'PENDING':
            return jsonify({'status': 'pending'}), 202
        elif task.state == 'SUCCESS':
            return jsonify({'status': 'completed', 'context': task.result})
        elif task.state == 'FAILURE':
            return jsonify({'status': 'failed', 'error': str(task.result)}), 500
        else:
            return jsonify({'status': 'unknown', 'state': task.state}), 500
    except Exception as e:
        logger.error(f"Error in get_context_result: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@app.teardown_appcontext
def shutdown_session(exception=None):
    db.session.remove()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
