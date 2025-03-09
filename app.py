from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
from flask_cors import CORS
import re
import requests
from google.cloud import translate_v2 as translate
import logging
import gc
import ssl
from urllib.parse import parse_qsl, urlencode, urlparse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Celery configuration
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
celery = Celery(app.name, broker=REDIS_URL)
celery.conf.update(app.config)
celery.conf.update(
    broker_url=REDIS_URL,
    result_backend=REDIS_URL,
    worker_max_tasks_per_child=100,
    worker_max_memory_per_child=800000,  # 800MB
    worker_concurrency=1
)

if REDIS_URL.startswith('rediss://'):
    celery.conf.broker_use_ssl = {
        'ssl_cert_reqs': ssl.CERT_NONE
    }
    celery.conf.redis_backend_use_ssl = {
        'ssl_cert_reqs': ssl.CERT_NONE
    }

# Translation API configuration
translate_client = translate.Client()

# Database configuration
# Before setting up SQLAlchemy
db_url = os.environ.get('DB_CONNECTION_STRING')
if db_url:
    # Parse the URL to handle boolean parameters correctly
    parsed = urlparse(db_url)
    query_params = dict(parse_qsl(parsed.query))
    
    # List of parameters that should be booleans
    bool_params = ['ssl_verify_identity', 'use_pure', 'autocommit', 'raise_on_warnings', 
                   'get_warnings', 'ssl_verify_cert', 'consume_results']
    
    for param in bool_params:
        if param in query_params:
            value = query_params[param].lower()
            if value in ('true', 'yes', '1'):
                query_params[param] = True
            elif value in ('false', 'no', '0'):
                query_params[param] = False
    
    # Reconstruct the URL
    new_query = urlencode(query_params)
    new_url = parsed._replace(query=new_query).geturl()
    app.config['SQLALCHEMY_DATABASE_URI'] = new_url

db = SQLAlchemy(app)

class CommonFrenchWord(db.Model):
    __tablename__ = 'common_words_fr_freq20'
    id = db.Column(db.Integer, primary_key=True)
    word = db.Column(db.String(255), unique=True, nullable=False)
    frequency_film = db.Column(db.Float)
    frequency_book = db.Column(db.Float)
    frequency_avg = db.Column(db.Float)

@celery.task(bind=True, max_retries=3)
def generate_context_task(self, lyric):
    try:
        return process_context_generation(lyric)
    except Exception as e:
        logger.error(f"Task {self.request.id} failed: {str(e)}", exc_info=True)
        self.retry(exc=e, countdown=60)

def process_context_generation(lyric: str) -> str:
    try:
        logger.info(f"Starting context generation for lyric: {lyric}")
        
        # Detect language (optional, as we know it's French)
        detection = translate_client.detect_language(lyric)
        source_language = detection['language']
        
        # Translate to English
        translation = translate_client.translate(
            lyric,
            target_language='en',
            source_language=source_language
        )
        
        translated_text = translation['translatedText']
        
        logger.info("Translation completed successfully")
        return f'This word is used in the lyric, "{lyric}", which translates to "{translated_text}" in English.'
    except Exception as e:
        logger.error(f"Error in translation: {str(e)}", exc_info=True)
        raise

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
        
        # Use OR conditions instead of .in_()
        conditions = [CommonFrenchWord.word == word for word in words]
        if conditions:
            matching_words = db.session.query(CommonFrenchWord.word).filter(
                db.or_(*conditions)
            ).order_by(db.desc(CommonFrenchWord.frequency_avg)).limit(10).all()
        else:
            matching_words = []
        
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
    except translate.exceptions.GoogleAPIError as e:
        logger.error(f"Google Translate API error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Translation service unavailable'}), 503
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Network error occurred'}), 503
    except Exception as e:
        logger.error(f"Unexpected error in generate_context: {str(e)}", exc_info=True)
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
