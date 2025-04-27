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
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=20', {
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
    // Clear the container
    const container = document.getElementById('recently-played');
    container.innerHTML = '';
    
    // Create header
    const header = document.createElement('h2');
    header.textContent = "Select Tracks to Display";
    container.appendChild(header);
    
    // Create track selection list
    const selectionList = document.createElement('div');
    selectionList.className = 'track-selection';
    
    // Create loading indicator
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Detecting languages...';
    container.appendChild(loading);

    // Store processed tracks for later use
    const processedTracks = [];
    
    // Process all tracks for language detection
    for (const item of tracks) {
        const track = item.track;
        const songName = track.name;
        const artistName = track.artists.map(artist => artist.name).join(', ');
        
        const lyrics = await fetchLyrics(artistName, songName);
        if (!lyrics) continue;
        
        // Detect language
        const langResponse = await fetch('/api/detect-language', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: lyrics })
        });
        
        if (!langResponse.ok) continue;
        
        const langData = await langResponse.json();
        
        // Store processed track data
        processedTracks.push({
            track,
            artistName,
            songName,
            lyrics,
            language: langData.language,
            confidence: langData.confidence
        });
        
        // Create track card
        const trackCard = document.createElement('div');
        trackCard.className = 'track-card';
        trackCard.dataset.index = processedTracks.length - 1;
        
        trackCard.innerHTML = `
            <label>
                <input type="checkbox" class="track-checkbox">
                <span class="track-name">${songName} - ${artistName}</span>
                <span class="language-badge ${langData.language}">${langData.language.toUpperCase()}</span>
                <span class="confidence">(${Math.round(langData.confidence * 100)}%)</span>
            </label>
        `;
        selectionList.appendChild(trackCard);
    }
    
    // Remove loading indicator and add selection list
    loading.remove();
    container.appendChild(selectionList);
    
    // Add button
    const addButton = document.createElement('button');
    addButton.textContent = 'Add Selected to Table';
    addButton.className = 'add-button';
    container.appendChild(addButton);
    
    // Create the tracks table with original columns (only once)
    const tableContainer = document.createElement('div');
    tableContainer.id = 'tracks-table-container';
    
    const table = document.createElement('table');
    table.id = 'tracks-table';
    table.className = 'tracks-table';
    table.innerHTML = `
        <tr>
            <th>Song</th>
            <th>Common Word</th>
            <th>Translation</th>
            <th>Context</th>
        </tr>
    `;
    container.appendChild(tableContainer);
    tableContainer.appendChild(table);

    // After appending all rows:
    enableSwipeToDelete('tracks-table');

    // Handle "Add to Table" button click
    addButton.addEventListener('click', async () => {
        const selectedCheckboxes = document.querySelectorAll('.track-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            alert('Please select at least one track');
            return;
        }
        
        // Clear existing rows except header
        while (table.rows.length > 1) {
            table.deleteRow(1);
        }
        
        // Process each selected track
        for (const checkbox of selectedCheckboxes) {
            const trackCard = checkbox.closest('.track-card');
            const trackIndex = parseInt(trackCard.dataset.index);
            const trackData = processedTracks[trackIndex];
            
            // Get common words for this track
            const commonWords = await fetchCommonFrenchWords(trackData.lyrics);
            
            // Create a row for each common word found
            for (const wordData of commonWords) {
                const word = typeof wordData === 'object' ? wordData.word : wordData;
                const translation = typeof wordData === 'object' ? (wordData.translation || 'N/A') : 'N/A';
                
                const row = table.insertRow();
                row.innerHTML = `
                    <td>${trackData.songName} - ${trackData.artistName}</td>
                    <td>${word}</td>
                    <td>${translation}</td>
                    <td class="context-cell">
                        <button class="generate-context-btn">Generate Context</button>
                        <div class="context-content" style="display: none;"></div>
                    </td>
                `;
                
                // Set up context generation functionality
                const generateContextBtn = row.querySelector('.generate-context-btn');
                const contextContent = row.querySelector('.context-content');
                
                generateContextBtn.onclick = async () => {
                    try {
                        generateContextBtn.disabled = true;
                        generateContextBtn.textContent = 'Generating...';
                        
                        // Find the lyric containing the common word
                        const lyricWithWord = trackData.lyrics.split('\n').find(line => 
                            line.toLowerCase().includes(word.toLowerCase())
                        );
                        
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
            }
        }
    });
}

function enableSwipeToDelete(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  function bindSwipeEvents(row) {
    let startX = 0;
    let swiped = false;

    // Touch events for mobile
    row.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX;
      this.classList.remove('delete-bg');
      this.style.transition = '';
    });

    row.addEventListener('touchmove', function(e) {
      const deltaX = e.touches[0].clientX - startX;
      if (deltaX < -30) {
        this.style.transform = `translateX(${deltaX}px)`;
        if (Math.abs(deltaX) > 80) {
          this.classList.add('delete-bg');
          swiped = true;
        } else {
          this.classList.remove('delete-bg');
          swiped = false;
        }
      }
    });

    row.addEventListener('touchend', function(e) {
      if (swiped) {
        this.style.transition = 'transform 0.3s, opacity 0.3s';
        this.style.transform = 'translateX(-100%)';
        this.style.opacity = '0';
        setTimeout(() => {
          this.remove();
        }, 300);
      } else {
        this.style.transform = '';
        this.classList.remove('delete-bg');
      }
      swiped = false;
    });

    // Mouse events for desktop
    let mouseStartX = 0;
    let mouseDown = false;
    row.addEventListener('mousedown', function(e) {
      mouseStartX = e.clientX;
      mouseDown = true;
      this.classList.remove('delete-bg');
      this.style.transition = '';
    });
    row.addEventListener('mousemove', function(e) {
      if (!mouseDown) return;
      const deltaX = e.clientX - mouseStartX;
      if (deltaX < -30) {
        this.style.transform = `translateX(${deltaX}px)`;
        if (Math.abs(deltaX) > 80) {
          this.classList.add('delete-bg');
          swiped = true;
        } else {
          this.classList.remove('delete-bg');
          swiped = false;
        }
      }
    });
    row.addEventListener('mouseup', function(e) {
      if (swiped) {
        this.style.transition = 'transform 0.3s, opacity 0.3s';
        this.style.transform = 'translateX(-100%)';
        this.style.opacity = '0';
        setTimeout(() => {
          this.remove();
        }, 300);
      } else {
        this.style.transform = '';
        this.classList.remove('delete-bg');
      }
      mouseDown = false;
      swiped = false;
    });
    row.addEventListener('mouseleave', function(e) {
      if (!swiped) {
        this.style.transform = '';
        this.classList.remove('delete-bg');
      }
      mouseDown = false;
    });
  }

  // Bind events to all rows
  table.querySelectorAll('tbody tr').forEach(row => {
    bindSwipeEvents(row);
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
