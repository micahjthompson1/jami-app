from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
from flask_cors import CORS
import re
import requests
import torch
from transformers import MarianMTModel, MarianTokenizer
import logging
import gc
import ssl
import time
from typing import List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DB_CONNECTION_STRING')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Celery configuration
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
celery = Celery(app.name, broker=REDIS_URL)
celery.conf.update(app.config)
celery.conf.update(
    broker_url=REDIS_URL,
    result_backend=REDIS_URL,
    worker_max_tasks_per_child=50,  # Reduced for memory safety
    worker_max_memory_per_child=500000,  # 500MB
    worker_concurrency=1
)

if REDIS_URL.startswith('rediss://'):
    celery.conf.broker_use_ssl = {'ssl_cert_reqs': ssl.CERT_NONE}
    celery.conf.redis_backend_use_ssl = {'ssl_cert_reqs': ssl.CERT_NONE}

class CommonFrenchWord(db.Model):
    __tablename__ = 'common_words_fr_freq20'
    id = db.Column(db.Integer, primary_key=True)
    word = db.Column(db.String(255), unique=True, nullable=False)
    frequency_film = db.Column(db.Float)
    frequency_book = db.Column(db.Float)
    frequency_avg = db.Column(db.Float)

# Model initialization
model = None
tokenizer = None

def get_device():
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")

def initialize_model():
    global model, tokenizer
    if model is None:
        logger.info("Initializing translation model...")
        try:
            model = MarianMTModel.from_pretrained("Helsinki-NLP/opus-mt-fr-en")
            tokenizer = MarianTokenizer.from_pretrained("Helsinki-NLP/opus-mt-fr-en")
            device = get_device()
            model = model.to(device)
            model.eval()
            logger.info(f"Model loaded on {device}")
            if torch.cuda.is_available():
                logger.info(f"GPU Memory: {torch.cuda.memory_allocated()/1024**2:.2f}MB allocated")
        except Exception as e:
            logger.error(f"Model initialization failed: {str(e)}")
            raise

# Celery worker startup hook
@celery.on_after_configure.connect
def setup_model(sender, **kwargs):
    initialize_model()

@celery.task(bind=True, max_retries=3)
def generate_context_task(self, lyric):
    try:
        start_time = time.time()
        logger.info(f"Starting translation task {self.request.id}")
        
        # Input validation
        if not lyric.strip():
            raise ValueError("Empty input string")
            
        # Token length check
        tokens = tokenizer.tokenize(lyric)
        if len(tokens) > 256:
            lyric = tokenizer.convert_tokens_to_string(tokens[:256])
            logger.warning("Input truncated to 256 tokens")

        # Tokenization with proper MarianMT formatting
        inputs = tokenizer(
            [lyric],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=256,
            add_special_tokens=True
        ).to(get_device())
        
        # Model generation with MarianMT parameters
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_length=512,
                num_beams=4,
                early_stopping=True,
                no_repeat_ngram_size=3,
                length_penalty=0.6,
                decoder_start_token_id=model.config.decoder_start_token_id
            )
            
        translated_text = tokenizer.decode(
            outputs[0],
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True
        )
        
        logger.info(f"Translation completed in {time.time()-start_time:.2f}s")
        return {
            "french": lyric,
            "english": translated_text
        }
        
    except Exception as e:
        logger.error(f"Translation failed: {str(e)}")
        self.retry(exc=e, countdown=60)
    finally:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()

@app.route('/api/health')
def health_check():
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "gpu_available": torch.cuda.is_available(),
        "gpu_memory": f"{torch.cuda.memory_allocated()/1024**2:.2f}MB" if torch.cuda.is_available() else "N/A"
    })

@app.route('/api/test-tokenizer', methods=['POST'])
def test_tokenizer():
    lyric = request.json.get('lyric', 'Bonjour le monde')
    tokens = tokenizer.tokenize(lyric)
    return jsonify({
        'tokens': tokens,
        'token_count': len(tokens),
        'device': str(get_device())
    })

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
        ).order_by(CommonFrenchWord.frequency_avg).limit(10).all()
        
        result = [word[0] for word in matching_words]
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in match_words: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        db.session.close()

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
    initialize_model()
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
