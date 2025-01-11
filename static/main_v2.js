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
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=3', {
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
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
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
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching common French words:', error);
        return [];
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
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.task_id;
    } catch (error) {
        console.error('Error generating context:', error);
        throw error;
    }
}

async function getContextResult(taskId) {
    try {
        const response = await fetch(`/api/get-context-result/${taskId}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching context result:', error);
        throw error;
    }
}

async function pollContextResult(taskId, maxAttempts = 10, interval = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
        const result = await getContextResult(taskId);
        if (result.status === 'completed') {
            return result.context;
        } else if (result.status === 'failed') {
            throw new Error('Context generation failed');
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error('Context generation timed out');
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
        <thead>
            <tr>
                <th>Track</th>
                <th>Artist</th>
                <th>Common French Words</th>
                <th>Context</th>
            </tr>
        </thead>
    `;
    table.innerHTML = tableHeader;
    container.appendChild(table);

    for (const item of tracks) {
        const track = item.track;
        const row = table.insertRow();
        row.insertCell().textContent = track.name;
        row.insertCell().textContent = track.artists.map(artist => artist.name).join(', ');

        const lyricsCell = row.insertCell();
        const contextCell = row.insertCell();

        const lyrics = await fetchLyrics(track.artists[0].name, track.name);
        if (lyrics) {
            const commonWords = await fetchCommonFrenchWords(lyrics);
            lyricsCell.textContent = commonWords.join(', ');

            if (commonWords.length > 0) {
                const contextButton = document.createElement('button');
                contextButton.textContent = 'Generate Context';
                contextButton.onclick = async () => {
                    try {
                        contextButton.disabled = true;
                        contextButton.textContent = 'Generating...';
                        const taskId = await fetchContextForLyric(commonWords[0]);
                        const context = await pollContextResult(taskId);
                        contextCell.textContent = context;
                    } catch (error) {
                        console.error('Error generating context:', error);
                        contextCell.textContent = 'Error generating context';
                    } finally {
                        contextButton.disabled = false;
                        contextButton.textContent = 'Generate Context';
                    }
                };
                contextCell.appendChild(contextButton);
            }
        } else {
            lyricsCell.textContent = 'Lyrics not found';
        }
    }
    
    container.appendChild(table);

    // Add click event listener for collapsible rows
    const songRows = table.querySelectorAll('tr');
    songRows.forEach(row => {
        row.addEventListener('click', () => {
            row.classList.toggle('expanded');
            const detailsCell = row.querySelector('td:nth-child(3), td:nth-child(4)');
            if (detailsCell) {
                detailsCell.classList.toggle('show-details');
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