from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
import logging

app = Flask(__name__)

# Set up logging
logging.basicConfig(filename='error.log', level=logging.ERROR)

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
    isrc = db.Column(db.String)
    word = db.Column(db.String)
    count = db.Column(db.Integer)
    id = db.Column(db.Integer, primary_key=True)

@app.route('/')
def index():
    dev_token = os.environ.get('apple_dev_token')
    return render_template('index.html', dev_token=dev_token)

# Changed logic for debugging
@app.route('/api/words', methods=['POST'])
def fetch_words():
    try:
        # Your logic to handle the request
        pass
    except Exception as e:
        app.logger.error(f"Error occurred: {e}")
        return {"error": "Internal Server Error"}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)