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
        <tr>
            <th>Song</th>
            <th>Common Word</th>
            <th>Context</th>
        </tr>
    `;
    table.innerHTML = tableHeader;
    container.appendChild(table);

    for (const item of tracks) {
        const track = item.track;
        const songName = track.name;
        const artistName = track.artists.map(artist => artist.name).join(', ');

        const lyrics = await fetchLyrics(artistName, songName);
        if (lyrics) {
            const commonWords = await fetchCommonFrenchWords(lyrics);

            for (const word of commonWords) {
                const row = table.insertRow();
                row.className = 'song-row';
                row.innerHTML = `
                    <td>${songName} - ${artistName}</td>
                    <td>${word}</td>
                    <td class="context-cell">
                        <button class="generate-context-btn">Generate Context</button>
                        <div class="context-content" style="display: none;"></div>
                    </td>
                `;

                const generateContextBtn = row.querySelector('.generate-context-btn');
                const contextContent = row.querySelector('.context-content');

                generateContextBtn.onclick = async () => {
                    try {
                        generateContextBtn.disabled = true;
                        generateContextBtn.textContent = 'Generating...';

                        // Find the lyric containing the common word
                        const lyricWithWord = lyrics.split('\n').find(line => line.toLowerCase().includes(word.toLowerCase()));

                        if (lyricWithWord) {
                            const taskId = await fetchContextForLyric(lyricWithWord);
                            const context = await pollContextResult(taskId);
                            contextContent.textContent = context;
                            contextContent.style.display = 'block';
                            generateContextBtn.style.display = 'none';
                        } else {
                            contextContent.textContent = 'Lyric containing the word not found.';
                            contextContent.style.display = 'block';
                            generateContextBtn.style.display = 'none';
                        }
                    } catch (error) {
                        console.error('Error generating context:', error);
                        contextContent.textContent = 'Error generating context';
                        contextContent.style.display = 'block';
                    } finally {
                        generateContextBtn.disabled = false;
                        generateContextBtn.textContent = 'Generate Context';
                    }
                };

                row.addEventListener('click', (event) => {
                    if (!event.target.classList.contains('generate-context-btn')) {
                        row.classList.toggle('expanded');
                        contextContent.style.display = contextContent.style.display === 'none' ? 'block' : 'none';
                    }
                });
            }
        }
    }
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