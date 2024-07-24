from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
from flask_cors import CORS
from collections import Counter

app = Flask(__name__)
CORS(app)

# Database configuration with SSL
base_connection_string = os.environ.get('DB_CONNECTION_STRING')
ssl_config = "&ssl_ca=/etc/ssl/cert.pem"

app.config['SQLALCHEMY_DATABASE_URI'] = base_connection_string + ssl_config
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Define your database model
class Base(db.Model):
    __tablename__ = 'base_w_isrc_new'
    id = db.Column(db.Integer, primary_key=True)
    song_id = db.Column(db.String)
    isrc = db.Column(db.String) 
    word = db.Column(db.String)
    translation = db.Column(db.String)
    count = db.Column(db.Integer)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/words', methods=['POST'])
def get_words():
    try:
        data = request.get_json()
        app.logger.info(f"Received data: {data}")
        if data is None:
            raise ValueError("No JSON data received")

        isrc_codes = data.get('isrcCodes', [])
        if not isrc_codes:
            raise ValueError("No ISRC codes provided")

        # Query the database using ISRC codes
        query = db.session.query(Base.word, Base.translation, Base.isrc, Base.count).\
            filter(Base.isrc.in_(isrc_codes))

        results = query.all()

        # Group words by ISRC and calculate total count
        words_by_isrc = {}
        for row in results:
            if row.isrc not in words_by_isrc:
                words_by_isrc[row.isrc] = {}

            word_key = (row.word, row.translation)
            if word_key in words_by_isrc[row.isrc]:
                words_by_isrc[row.isrc][word_key] += row.count
            else:
                words_by_isrc[row.isrc][word_key] = row.count

        # Format the results
        words = []
        for isrc, word_counts in words_by_isrc.items():
            for (word, translation), count in word_counts.items():
                if count > 1:
                    words.append({
                        'word': word,
                        'translation': translation,
                        'total_count': count,
                        'isrc': isrc
                    })

        # Sort the results by total_count in descending order
        words.sort(key=lambda x: x['total_count'], reverse=True)

        return jsonify(words)
    except ValueError as ve:
        app.logger.error(f"ValueError: {ve}")
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        app.logger.error(f"Error occurred: {e}")
        return jsonify({"error": "Internal Server Error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)