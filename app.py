from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)

# Database configuration with SSL
base_connection_string = os.environ.get('DB_CONNECTION_STRING')
ssl_config = "?ssl_ca=/etc/ssl/cert.pem"

app.config['SQLALCHEMY_DATABASE_URI'] = base_connection_string + ssl_config
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Define your database model
class Base(db.Model):
    __tablename__ = 'base_w_isrc'
    song_id = db.Column(db.String)
    spotify_track_id = db.Column(db.String)
    word = db.Column(db.String)
    count = db.Column(db.Integer)
    id = db.Column(db.Integer, primary_key=True)

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

        track_ids = data.get('trackIds', [])
        if not track_ids:
            raise ValueError("No track IDs provided")

        # Query the database
        query = db.session.query(Base.word, db.func.sum(Base.count).label('total_count')).\
            filter(Base.spotify_track_id.in_(track_ids)).\
            group_by(Base.word).\
            order_by(db.desc('total_count'))

        results = query.all()

        # Format the results
        words = [{'word': row.word, 'total_count': int(row.total_count)} for row in results]

        return jsonify(words)
    except ValueError as ve:
        app.logger.error(f"ValueError: {ve}")
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        app.logger.error(f"Error occurred: {e}")
        return jsonify({"error": "Internal Server Error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)