const clientId = '74fd0dba781e434dad39a8494e5426b9';
const redirectUri = 'https://wordnab.onrender.com/';
const scopes = 'user-read-recently-played';
const MAX_POLL_ATTEMPTS = 60;  // Increased from 30
const POLL_INTERVAL = 10000;   // 10 seconds interval

// Health check on startup
document.addEventListener('DOMContentLoaded', () => {
    checkBackendHealth();
});

async function checkBackendHealth() {
    try {
        const response = await fetch('/api/health');
        const health = await response.json();
        if (!health.model_loaded) {
            showError('Translation engine is not ready');
        }
    } catch (error) {
        showError('Backend service unavailable');
    }
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

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
        const response = await fetch(`/api/get-context-result/?task_id=${taskId}`);
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

// Updated polling with new response format
async function pollContextResult(taskId) {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        try {
            const response = await fetch(`/api/get-context-result/?task_id=${taskId}`);
            const data = await response.json();
            
            if (data.status === 'completed') {
                return {
                    french: data.context.french,
                    english: data.context.english
                };
            } else if (data.status === 'failed') {
                throw new Error(data.error || 'Context generation failed');
            }
            
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        } catch (error) {
            throw new Error(`Polling failed: ${error.message}`);
        }
    }
    throw new Error('Max polling attempts reached');
}

// Updated context generation handler
async function handleGenerateContext() {
    try {
        const lyric = document.getElementById('lyric-input').value;
        
        if (!lyric.trim()) {
            showError('Please enter some text to translate');
            return;
        }

        const response = await fetch('/api/generate-context', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ lyric }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            showError(errorData.error || 'Translation failed');
            return;
        }

        const { task_id } = await response.json();
        const result = await pollContextResult(task_id);
        
        // Display structured results
        document.getElementById('french-text').textContent = result.french;
        document.getElementById('english-text').textContent = result.english;

    } catch (error) {
        showError(`Error: ${error.message}`);
    }
}

// Updated track display with error handling
async function displayTracksAndWords(tracks, accessToken) {
    const container = document.getElementById('recently-played');
    container.innerHTML = '';
    
    try {
        const header = document.createElement('h2');
        header.textContent = "Recently Played Tracks:";
        container.appendChild(header);

        const table = document.createElement('table');
        table.className = 'collapsible-table';
        
        // Table header remains the same
        table.innerHTML = `
            <tr>
                <th>Track</th>
                <th>Artist</th>
                <th>Lyrics Preview</th>
                <th>Common Words</th>
                <th>Context</th>
            </tr>
        `;

        for (const item of tracks) {
            const track = item.track;
            const row = document.createElement('tr');
            
            // Track and artist cells remain the same
            row.innerHTML = `
                <td>${track.name}</td>
                <td>${track.artists.map(artist => artist.name).join(', ')}</td>
                <td class="lyrics-cell"></td>
                <td class="words-cell"></td>
                <td class="context-cell"></td>
            `;

            // Lyrics handling with error feedback
            const lyricsCell = row.querySelector('.lyrics-cell');
            const wordsCell = row.querySelector('.words-cell');
            const contextCell = row.querySelector('.context-cell');
            
            try {
                const lyrics = await fetchLyrics(track.artists[0].name, track.name);
                if (lyrics) {
                    lyricsCell.textContent = `${lyrics.substring(0, 100)}...`;
                    
                    const commonWords = await fetchCommonFrenchWords(lyrics);
                    wordsCell.innerHTML = commonWords.map(word => 
                        `<button class="word-btn" onclick="handleWordClick('${word}')">${word}</button>`
                    ).join(' ');
                }
            } catch (error) {
                lyricsCell.textContent = 'Lyrics unavailable';
                console.error('Lyrics error:', error);
            }

            // Context generation button
            const contextButton = document.createElement('button');
            contextButton.textContent = 'Generate Context';
            contextButton.onclick = async () => {
                try {
                    contextButton.disabled = true;
                    const lyric = track.name; // Or use selected lyrics
                    const result = await handleGenerateContext(lyric);
                    contextCell.innerHTML = `
                        <div class="french-text">${result.french}</div>
                        <div class="english-text">${result.english}</div>
                    `;
                } catch (error) {
                    showError(`Context generation failed: ${error.message}`);
                } finally {
                    contextButton.disabled = false;
                }
            };
            contextCell.appendChild(contextButton);

            table.appendChild(row);
        }

        container.appendChild(table);
    } catch (error) {
        showError(`Failed to load tracks: ${error.message}`);
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
