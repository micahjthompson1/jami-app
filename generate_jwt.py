import jwt
import os

# Define the headers and payload data
headers = {
    "alg": "ES256",
    "kid": "S58SX3552C"
}

payload = {
    "iss": "4UY2Y7AYCM",
    "iat": 1709751751,
    "exp": 1725528751
}

# Sign the token using jwt.encode()
my_secret = os.environ['private_key']
private_key = f"-----BEGIN PRIVATE KEY-----\n{my_secret}\n-----END PRIVATE KEY-----"
token = jwt.encode(payload, private_key, algorithm='ES256', headers=headers)

print(token)