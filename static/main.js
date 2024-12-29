const clientId = '74fd0dba781e434dad39a8494e5426b9';
const redirectUri = 'https://jami-app.onrender.com/';
const scopes = 'user-read-recently-played';

function getSpotifyAuthUrl() {
  const url = 'https://accounts.spotify.com/authorize';
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: scopes,
  });
  return `${url}?${params.toString()}`;
}

function getAccessTokenFromUrl() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  return params.get('access_token');
}

async function fetchRecentlyPlayed(accessToken) {
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });
    const data = await response.json();
    return data.items;
}

async function fetchLyrics(artist, title) {
    try {
        const apiUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
        const response = await fetch(`/proxy?url=${encodeURIComponent(apiUrl)}`);
        const data = await response.json();
        return data.lyrics;
    } catch (error) {
        console.error('Error fetching lyrics:', error);
        return null;
    }
}

async function fetchCommonFrenchWords(lyrics) {
    try {
        const response = await fetch('/api/match-words', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ lyrics }),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching common French words:', error);
        throw error;
    }
}

async function displayTracksAndWords(tracks, accessToken) {
    const container = document.getElementById('recently-played');
    container.innerHTML = '';

    const header = document.createElement('h2');
    header.textContent = "Recently Played Tracks:";
    container.appendChild(header);

    const table = document.createElement('table');
    const tableHeader = `
        <tr>
            <th>Track</th>
            <th>Artist</th>
            <th>Common French Words</th>
        </tr>
    `;
    table.innerHTML = tableHeader;

    for (const item of tracks) {
        const track = item.track;
        const artist = track.artists[0].name;
        const title = track.name;

        const lyrics = await fetchLyrics(artist, title);
        const commonWords = lyrics ? await fetchCommonFrenchWords(lyrics) : [];

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${title}</td>
            <td>${artist}</td>
            <td>${commonWords.join(', ')}</td>
        `;
        table.appendChild(row);
    }

    container.appendChild(table);
}

function generateCsv(words) {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Word,Translation,Count\n";
  words.forEach(word => {
    csvContent += `${word.word},${word.translation},${word.total_count}\n`;
  });
  return encodeURI(csvContent);
}

function downloadCsv(words) {
  const csvContent = generateCsv(words);
  const link = document.createElement("a");
  link.setAttribute("href", csvContent);
  link.setAttribute("download", "word_data.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function setupDownloadButton(words) {
  const downloadButton = document.getElementById('downloadCsv');
  downloadButton.style.display = 'inline-block';
  downloadButton.addEventListener('click', () => downloadCsv(words));
}

async function main() {
  document.getElementById('downloadCsv').style.display = 'none';
  let accessToken = getAccessTokenFromUrl();
  if (!accessToken) {
    window.location.href = getSpotifyAuthUrl();
  } else {
    const tracks = await fetchRecentlyPlayed(accessToken);
    await displayTracksAndWords(tracks, accessToken);
  }
}

main();