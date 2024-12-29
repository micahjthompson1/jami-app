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
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=5', {
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

async function fetchContextForLyric(lyric) {
    try {
        const response = await fetch('/api/generate-context', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ lyric }),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error generating context:', error);
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
    table.className = 'collapsible-table';
    const tableHeader = `
        <tr>
            <th>Song</th>
            <th>Common Word</th>
            <th>Context</th>
        </tr>
    `;
    table.innerHTML = tableHeader;

    for (const item of tracks) {
        const track = item.track;
        const artist = track.artists[0].name;
        const title = track.name;

        const lyrics = await fetchLyrics(artist, title);
        const commonWords = lyrics ? await fetchCommonFrenchWords(lyrics) : [];

        const songRow = document.createElement('tr');
        songRow.className = 'song-row';
        songRow.innerHTML = `
            <td colspan="3">${title} - ${artist}</td>
        `;
        table.appendChild(songRow);

        for (const word of commonWords) {
            const lyricLine = lyrics.split('\n').find(line => line.includes(word));
            const context = await fetchContextForLyric(lyricLine);

            const wordRow = document.createElement('tr');
            wordRow.className = 'word-row hidden';
            wordRow.innerHTML = `
                <td></td>
                <td>${word}</td>
                <td>${context}</td>
            `;
            table.appendChild(wordRow);
        }
    }

    container.appendChild(table);

    // Add click event listener for collapsible rows
    const songRows = document.querySelectorAll('.song-row');
    songRows.forEach(row => {
        row.addEventListener('click', () => {
            const wordRows = row.nextElementSibling;
            while (wordRows && wordRows.classList.contains('word-row')) {
                wordRows.classList.toggle('hidden');
                wordRows = wordRows.nextElementSibling;
            }
        });
    });
}

async function main() {
  let accessToken = getAccessTokenFromUrl();
  if (!accessToken) {
    window.location.href = getSpotifyAuthUrl();
  } else {
    const tracks = await fetchRecentlyPlayed(accessToken);
    await displayTracksAndWords(tracks, accessToken);
  }
}

main();