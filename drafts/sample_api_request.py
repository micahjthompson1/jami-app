import applemusicpy

# Your Developer Token
developer_token = 'apple_dev_token'
key_id = 'S58SX3552C'
team_id = '4UY2Y7AYCM'

# Initialize the AppleMusic client
am = applemusicpy.AppleMusic(developer_token, key_id, team_id)

# Perform a search
results = am.search('travis scott', types=['albums'], limit=5)
for item in results['results']['albums']['data']:
    print(item['attributes']['name'])