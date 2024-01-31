from flask import Flask, render_template
from database import load_words_from_db

app = Flask(__name__)

@app.route("/")
def hello_jami():
  words_list = load_words_from_db()
  return render_template('home.html', words=words_list)

if __name__ == '__main__':
  app.run(host='0.0.0.0', debug=True)