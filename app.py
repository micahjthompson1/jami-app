from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
from flask_cors import CORS
from collections import Counter
import re 
import requests

app = Flask(__name__)
CORS(app)

# Database configuration with SSL
base_connection_string = os.environ.get('DB_CONNECTION_STRING')
ssl_config = "&ssl_ca=/etc/ssl/cert.pem"

app.config['SQLALCHEMY_DATABASE_URI'] = base_connection_string + ssl_config
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Define the CommonFrenchWord model
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
    return render_template('index.html')  # To serve frontend with Flask

@app.route('/api/match-words', methods=['POST'])
def match_words():
    try:
        lyrics = request.json.get('lyrics')
        if not lyrics:
            return jsonify({'error': 'Lyrics are required'}), 400

        print("Received lyrics:", lyrics[:100])  # Print first 100 characters of lyrics

        words = re.findall(r'\w+', lyrics.lower())
        print("Extracted words:", words[:10])  # Print first 10 words

        matching_words = CommonFrenchWord.query.filter(CommonFrenchWord.word.in_(words)).all()
        print("Matching words found:", len(matching_words))

        result = [word.word for word in matching_words]
        return jsonify(result)

    except Exception as e:
        print('Error in match_words:', str(e))
        import traceback
        traceback.print_exc()  # This will print the full stack trace
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)