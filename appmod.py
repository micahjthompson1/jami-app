from flask import Flask, redirect, request
import requests

app = Flask(__name__)

# Client credentials
CLIENT_ID = 'your_client_id'
CLIENT_SECRET = 'your_client_secret'
REDIRECT_URI = 'http://localhost:5000/callback'

@app.route('/login')
def login():
    # Redirect the user to Apple's authorization endpoint
    authorization_url = 'https://appleid.apple.com/auth/authorize'
    params = {
        'response_type': 'code',
        'client_id': CLIENT_ID,
        'redirect_uri': REDIRECT_URI,
        'scope': 'user-read-recently-played'  # Example scope for Apple Music
    }
    return redirect(authorization_url + '?' + '&'.join([f'{key}={val}' for key, val in params.items()]))

@app.route('/callback')
def callback():
    # Handle the callback after the user authorizes your app
    code = request.args.get('code')
    if code:
        # Exchange authorization code for access token
        token_url = 'https://appleid.apple.com/auth/token'
        data = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': REDIRECT_URI,
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET
        }
        response = requests.post(token_url, data=data)
        if response.ok:
            access_token = response.json()['access_token']
            # Now you can use the access token to make authenticated requests to the API
            return f'Access Token: {access_token}'
        else:
            return 'Failed to retrieve access token'
    else:
        return 'Authorization code not found'

if __name__ == '__main__':
    app.run(debug=True)
