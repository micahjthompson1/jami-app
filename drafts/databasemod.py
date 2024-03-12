from sqlalchemy import create_engine, text
import os
import requests

# Function to fetch recent tracks from Apple Music API
def fetch_recent_tracks(developer_token):
    url = "https://api.music.apple.com/v1/me/recent/played/tracks"
    headers = {
        "Authorization": f"Bearer {developer_token}",
        "Content-Type": "application/json"
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        return response.json()
    else:
        print("Failed to fetch recent tracks:", response.text)
        return None

developer_token = os.environ['developer_token']
recent_tracks_response = fetch_recent_tracks(developer_token)
print(recent_tracks_response)