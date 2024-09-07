from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
from flask_cors import CORS
from collections import Counter
import re  # Add this import

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

# Create tables
with app.app_context():
    db.create_all()

@app.route('/')
def index():
    return render_template('index.html')  # To serve frontend with Flask

@app.route('/api/match-words', methods=['POST'])
def match_words():
    lyrics = request.json.get('lyrics')

    if not lyrics:
        return jsonify({'error': 'Lyrics are required'}), 400

    try:
        # Split lyrics into words and remove punctuation
        words = re.findall(r'\w+', lyrics.lower())

        # Query the database for matching words
        matching_words = CommonFrenchWord.query.filter(CommonFrenchWord.word.in_(words)).all()

        # Extract matching words from the result
        result = [word.word for word in matching_words]

        return jsonify(result)

    except Exception as e:
        print('Error matching words:', str(e))
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)