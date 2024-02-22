from sqlalchemy import create_engine, text
import os
import requests

# Function to fetch recent tracks from Apple Music API
def fetch_recent_tracks(access_token):
    url = "https://api.music.apple.com/v1/me/recent/played/tracks"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        return response.json()
    else:
        print("Failed to fetch recent tracks:", response.text)
        return None

# Extract IDs from the JSON response
def load_words_from_db(json_response):
  ids = [song['id'] for song in json_response['data']]

  # Create SQL query with placeholders for the IDs
  query = text("""
      SELECT word, CAST(sum(count) AS CHAR) AS total_count
      FROM base
      WHERE id IN :ids
      GROUP BY word
  """)

  with engine.connect() as conn:
      # Execute the query with IDs from the JSON response
      result = conn.execute(query, ids=ids)
      words = [row._asdict() for row in result.all()]
      return words

# Example usage:
json_response = { ... }  # Your JSON response here
words = load_words_from_db(json_response)
print(words)

# Your existing code for database connection and querying
db_connection_string = os.environ['DB_CONNECTION_STRING']

engine = create_engine(
    db_connection_string,
    connect_args={
        "ssl": {
            "ssl_ca": "/etc/ssl/cert.pem"
        }
    }
)

# Example usage
if __name__ == "__main__":
    access_token = "YOUR_ACCESS_TOKEN"  # Replace with your access token
    recent_tracks_response = fetch_recent_tracks(access_token)
    if recent_tracks_response:
        words = load_words_from_db(recent_tracks_response)
        print(words)