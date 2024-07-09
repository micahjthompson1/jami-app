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
    isrc = db.Column(db.String)
    word = db.Column(db.String)
    count = db.Column(db.Integer)
    id = db.Column(db.Integer, primary_key=True)

@app.route('/')
def index():
    dev_token = os.environ.get('apple_dev_token')
    return render_template('index.html', dev_token=dev_token)

@app.route('/api/words', methods=['POST'])
def get_words():
    isrc_codes = request.json.get('isrcCodes', [])

    # Query the database
    query = db.session.query(Base.word, db.func.sum(Base.count).label('total_count')).\
        filter(Base.isrc.in_(isrc_codes)).\
        group_by(Base.word).\
        order_by(db.desc('total_count'))

    results = query.all()

    # Format the results
    words = [{'word': row.word, 'total_count': int(row.total_count)} for row in results]

    return jsonify(words)

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)