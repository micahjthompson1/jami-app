from sqlalchemy import create_engine, text
import os

db_connection_string = os.environ['DB_CONNECTION_STRING']

engine = create_engine(
  db_connection_string, 
  connect_args={
    "ssl": {
      "ssl_ca": "/etc/ssl/cert.pem"
    }
  })

def load_words_from_db_old():
  with engine.connect() as conn:
    result = conn.execute(text("SELECT word, CAST(sum(count) AS CHAR) AS total_count FROM base WHERE song_id IN ('80','27') GROUP BY word")) 
    # TODO: Look for song_id in Recently Played table (Apple Music API)
    words = []
    for row in result.all():
      words.append(row._asdict())
    return words