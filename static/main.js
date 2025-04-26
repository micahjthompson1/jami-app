const clientId = '74fd0dba781e434dad39a8494e5426b9';
const redirectUri = 'https://wordnab.onrender.com/';
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
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=10', {
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

async function pollContextResult(taskId, maxAttempts = 60, interval = 10000) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getContextResult(taskId);
    if (result.status === 'completed') {
      return result.context;
    } else if (result.status === 'failed') {
      throw new Error('Context generation failed');
    } else if (result.status === 'pending') {
      // Continue polling
    } else {
      throw new Error('Unexpected status received');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Max polling attempts reached');
}

async function displayTracksAndWords(tracks, accessToken) {
    const container = document.getElementById('recently-played');
    container.innerHTML = '<h2>Select Tracks to Display</h2>';
    
    // Create track selection list
    const selectionList = document.createElement('div');
    selectionList.className = 'track-selection';
    
    // Create confirmation button
    const addButton = document.createElement('button');
    addButton.textContent = 'Add Selected to Table';
    addButton.className = 'add-button';
    
    // Create loading indicator
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Detecting languages...';
    container.appendChild(loading);

    // Process all tracks first
    const trackPromises = tracks.map(async (item) => {
        const lyrics = await fetchLyrics(item.track.artists[0].name, item.track.name);
        if (!lyrics) return null;
        
        // Detect language using your existing translation service
        const langResponse = await fetch('/api/detect-language', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: lyrics })
        });
        
        const langData = await langResponse.json();
        return {
            track: item.track,
            lyrics,
            language: langData.language,
            confidence: langData.confidence
        };
    });

    const processedTracks = (await Promise.all(trackPromises)).filter(t => t);
    loading.remove();

    // Create track cards with selection
    processedTracks.forEach(trackData => {
        const trackCard = document.createElement('div');
        trackCard.className = 'track-card';
        trackCard.innerHTML = `
            <label>
                <input type="checkbox" class="track-checkbox">
                <span class="track-name">${trackData.track.name}</span>
                <span class="language-badge ${trackData.language}">${trackData.language.toUpperCase()}</span>
                <span class="confidence">(${Math.round(trackData.confidence * 100)}%)</span>
            </label>
        `;
        selectionList.appendChild(trackCard);
    });

    container.appendChild(selectionList);
    container.appendChild(addButton);

    // Handle add to table
    addButton.addEventListener('click', () => {
        const selectedTracks = Array.from(document.querySelectorAll('.track-checkbox:checked'))
            .map(checkbox => {
                const card = checkbox.closest('.track-card');
                return {
                    name: card.querySelector('.track-name').textContent,
                    language: card.querySelector('.language-badge').textContent,
                    confidence: card.querySelector('.confidence').textContent
                };
            });

        updateTrackTable(selectedTracks);
    });
}

function updateTrackTable(tracks) {
    const table = document.querySelector('.tracks-table tbody');
    table.innerHTML = '';
    
    tracks.forEach(track => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${track.name}</td>
            <td><span class="language-badge ${track.language.toLowerCase()}">${track.language}</span></td>
            <td>${track.confidence}</td>
        `;
        table.appendChild(row);
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
