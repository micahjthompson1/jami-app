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
    __tablename__ = 'base_w_spotify_id'
    song_id = db.Column(db.String)
    spotify_track_id = db.Column(db.String)
    word = db.Column(db.String)
    count = db.Column(db.Integer)
    id = db.Column(db.Integer, primary_key=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/test', methods=['POST'])
def test_route():
    return jsonify({"message": "Test successful"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)