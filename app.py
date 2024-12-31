from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
from flask_cors import CORS
import re 
import requests
import torch
from transformers import MT5ForConditionalGeneration, MT5Tokenizer
from torch.nn.modules.lazy import LazyModuleMixin

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

# Lazy-loaded mT5 model and tokenizer
model = None
tokenizer = None

def load_model_and_tokenizer():
    global model, tokenizer
    if model is None or tokenizer is None:
        model = LazyMT5.from_pretrained("google/mt5-small")
        tokenizer = MT5Tokenizer.from_pretrained("google/mt5-small")
        model = model.half()  # Convert to float16 for memory efficiency


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

        words = set(re.findall(r'\w+', lyrics.lower()))  # Use a set for efficiency
        matching_words = CommonFrenchWord.query.with_entities(CommonFrenchWord.word).filter(CommonFrenchWord.word.in_(words)).all()
        result = [word[0] for word in matching_words]
        return jsonify(result)

    except Exception as e:
        print('Error in match_words:', str(e))
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/generate-context', methods=['POST'])
def generate_context():
    try:
        lyric = request.json.get('lyric')
        if not lyric:
            return jsonify({'error': 'Lyric is required'}), 400

        load_model_and_tokenizer()  # Ensure model and tokenizer are loaded

        input_text = f"Translate and explain the context of this French lyric: {lyric}"
        input_ids = tokenizer.encode(input_text, return_tensors="pt")

        with torch.no_grad():  # Disable gradient calculation for inference
            output = model.generate(input_ids, max_length=150, num_return_sequences=1)

        context = tokenizer.decode(output[0], skip_special_tokens=True)

        clear_memory()  # Clear memory after processing

        return jsonify({'context': context})

    except Exception as e:
        print('Error in generate_context:', str(e))
        clear_memory()  # Clear memory even if an error occurs
        return jsonify({'error': 'Internal server error'}), 500

def clear_memory():
    global model, tokenizer
    del model
    del tokenizer
    model = None
    tokenizer = None
    torch.cuda.empty_cache()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
