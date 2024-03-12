const mySecret = process.env['apple_dev_token']

// Configure MusicKit
MusicKit.configure({
  developerToken: mySecret,
  app: {
    name: 'WordNab',
    build: '2024.1.00.00',
  },
});

// Authorize and Fetch Data
async function fetchRecentlyPlayed() {
  const music = MusicKit.getInstance();
  await music.authorize();
  const { data: result } = await music.api.music('v1/me/recent/played/tracks');
  console.log(result.data);
}

fetchRecentlyPlayed();