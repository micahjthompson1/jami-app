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
    __tablename__ = 'base_latest_fr'
    id = db.Column(db.Integer, primary_key=True)
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

        # Count the occurrences of each ISRC code
        isrc_counts = Counter(isrc_codes)

        # Query the database using ISRC codes
        query = db.session.query(Base.word, Base.translation, Base.isrc, Base.count).\
            filter(Base.isrc.in_(isrc_codes))

        results = query.all()

        # Adjust the count based on the frequency of each ISRC code
        word_counts = {}
        valid_isrcs = set()
        for row in results:
            word_key = (row.word, row.translation, row.isrc)
            adjusted_count = row.count * isrc_counts[row.isrc]
            valid_isrcs.add(row.isrc)

            if word_key in word_counts:
                word_counts[word_key] += adjusted_count
            else:
                word_counts[word_key] = adjusted_count

        # Format the results
        words = [{'word': word, 'translation': translation, 'total_count': count, 'isrc': isrc} 
                 for (word, translation, isrc), count in word_counts.items() 
                 if count > 1]

        # Sort the results by total_count in descending order
        words.sort(key=lambda x: x['total_count'], reverse=True)

        return jsonify({"words": words, "valid_isrcs": list(valid_isrcs)})
    except ValueError as ve:
        app.logger.error(f"ValueError: {ve}")
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        app.logger.error(f"Error occurred: {e}")
        return jsonify({"error": "Internal Server Error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)