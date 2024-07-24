from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
from flask_cors import CORS
import mysql.connector
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

        # Count the occurrences of each ISRC code
        isrc_counts = Counter(isrc_codes)

        # Query the database using ISRC codes
        query = db.session.query(Base.word, Base.translation, db.func.sum(Base.count).label('total_count')).\
            filter(Base.isrc.in_(isrc_codes)).\
            group_by(Base.word, Base.translation).\
            having(db.func.sum(Base.count) > 1).\
            order_by(db.desc('total_count'))

        results = query.all()

        # Adjust the total_count based on the frequency of each ISRC code
        words = []
        for row in results:
            # Multiply the total count by the sum of counts for the corresponding ISRCs
            total_multiplier = sum(isrc_counts[isrc] for isrc in isrc_codes if isrc in isrc_counts)
            adjusted_count = int(row.total_count) * total_multiplier
            words.append({'word': row.word, 'translation': row.translation, 'total_count': adjusted_count})

        return jsonify(words)
    except ValueError as ve:
        app.logger.error(f"ValueError: {ve}")
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        app.logger.error(f"Error occurred: {e}")
        return jsonify({"error": "Internal Server Error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)