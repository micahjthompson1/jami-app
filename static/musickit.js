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

  // Get the container element where you want to display the data
  const container = document.getElementById('recently-played');

  // Clear previous content
  container.innerHTML = '';

  // Iterate over the fetched data and create elements for each item
  result.data.forEach(track => {
    // Create a new div element for each track
    const trackDiv = document.createElement('div');
    trackDiv.textContent = track.id; // Use the appropriate attribute for the track name

    // Append the new div to the container
    container.appendChild(trackDiv);
  });
}

fetchRecentlyPlayed();