from flask import Flask, render_template
import os

app = Flask(__name__)

@app.route('/')
def index():
    # Get the developer token from environment variables
    dev_token = os.environ.get('apple_dev_token')
    # Pass the developer token to the template
    return render_template('index.html', dev_token=dev_token)

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)