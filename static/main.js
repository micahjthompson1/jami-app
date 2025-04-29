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

    // Create the tracks table with proper structure
    const tableContainer = document.createElement('div');
    tableContainer.id = 'tracks-table-container';

    const table = document.createElement('table');
    table.id = 'tracks-table';
    table.className = 'tracks-table';

    // Use proper thead and tbody structure
    table.innerHTML = `
        <thead>
            <tr>
                <th>Song</th>
                <th>Common Word</th>
                <th>Translation</th>
                <th>Context</th>
            </tr>
        </thead>
        <tbody>
        </tbody>
    `;

    container.appendChild(tableContainer);
    tableContainer.appendChild(table);

    // Handle "Add to Table" button click
    addButton.addEventListener('click', async () => {
        const selectedCheckboxes = document.querySelectorAll('.track-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            alert('Please select at least one track');
            return;
        }

        // Get a reference to the tbody
        const tbody = table.querySelector('tbody');

        // Clear existing rows
        tbody.innerHTML = '';

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

                // Create row and append to tbody directly
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${trackData.songName} - ${trackData.artistName}</td>
                    <td>${word}</td>
                    <td>${translation}</td>
                    <td class="context-cell">
                        <button class="generate-context-btn">Generate Context</button>
                        <div class="context-content" style="display: none;"></div>
                    </td>
                `;

                tbody.appendChild(row);

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

        // Apply swipe-to-delete AFTER rows are added
        enableSwipeToDelete('tracks-table');
    });
}

// --- Swipe-to-delete function (delegation-based, robust) ---

function enableSwipeToDelete(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    let startX = 0;
    let currentRow = null;
    let isSwiping = false;

    // Touch event handlers
    table.addEventListener('touchstart', handleTouchStart, { passive: true });
    table.addEventListener('touchmove', handleTouchMove, { passive: true });
    table.addEventListener('touchend', handleTouchEnd);

    // Mouse event handlers
    table.addEventListener('mousedown', handleMouseDown);
    table.addEventListener('mousemove', handleMouseMove);
    table.addEventListener('mouseup', handleMouseUp);
    table.addEventListener('mouseleave', handleMouseLeave);

    function handleTouchStart(e) {
        if (e.touches.length > 1) return;
        startX = e.touches[0].clientX;
        currentRow = e.target.closest('tr');
        if (currentRow && currentRow.parentElement.tagName === 'TBODY') {
            currentRow.style.transition = 'none';
            isSwiping = true;
        } else {
            currentRow = null;
            isSwiping = false;
        }
    }

    function handleTouchMove(e) {
        if (!currentRow || !isSwiping) return;
        const deltaX = e.touches[0].clientX - startX;
        updateRowPosition(deltaX);
    }

    function handleTouchEnd() {
        if (!currentRow) return;
        finalizeSwipe();
        resetState();
    }

    function handleMouseDown(e) {
        if (e.button !== 0) return; // Only left mouse button
        startX = e.clientX;
        currentRow = e.target.closest('tr');
        if (currentRow && currentRow.parentElement.tagName === 'TBODY') {
            currentRow.style.transition = 'none';
            isSwiping = true;
        } else {
            currentRow = null;
            isSwiping = false;
        }
    }

    function handleMouseMove(e) {
        if (!currentRow || !isSwiping) return;
        const deltaX = e.clientX - startX;
        updateRowPosition(deltaX);
    }

    function handleMouseUp() {
        if (!currentRow) return;
        finalizeSwipe();
        resetState();
    }

    function handleMouseLeave() {
        if (!currentRow) return;
        resetRowPosition();
        resetState();
    }

    function updateRowPosition(deltaX) {
        if (deltaX < -30) { // Only handle left swipes
            currentRow.style.transform = `translateX(${deltaX}px)`;
            currentRow.classList.toggle('delete-bg', Math.abs(deltaX) > 80);
        }
    }

    function finalizeSwipe() {
        const match = currentRow.style.transform.match(/-?\d+/);
        const finalDelta = match ? parseInt(match[0]) : 0;
        if (Math.abs(finalDelta) > 80) {
            currentRow.classList.add('deleting'); 
            currentRow.style.transition = 'transform 0.3s, opacity 0.3s';
            currentRow.style.transform = 'translateX(-100%)';
            currentRow.style.opacity = '0';
            currentRow.style.height = '0'; 
            setTimeout(() => {
                if (currentRow && currentRow.parentElement) currentRow.remove();
            }, 300);
        } else {
            resetRowPosition();
        }
    }

    function resetRowPosition() {
        if (currentRow) {
            currentRow.style.transform = '';
            currentRow.classList.remove('delete-bg');
        }
    }

    function resetState() {
        currentRow = null;
        isSwiping = false;
    }
}

document.getElementById('download-csv').addEventListener('click', function() {
    // Get the table
    const table = document.getElementById('tracks-table');
    if (!table) {
        alert('No table found!');
        return;
    }

    // Find the indices for "Common Word" and "Translation" columns
    const headerCells = table.querySelectorAll('thead tr th');
    let commonWordIdx = -1;
    let translationIdx = -1;
    headerCells.forEach((cell, idx) => {
        const text = cell.innerText.trim().toLowerCase();
        if (text === 'common word') commonWordIdx = idx;
        if (text === 'translation') translationIdx = idx;
    });

    if (commonWordIdx === -1 || translationIdx === -1) {
        alert('Required columns not found!');
        return;
    }

    // Build CSV rows
    const csvRows = [];

    // Add header
    csvRows.push('"Common Word","Translation"');

    // Add data rows
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
        if (row.style.display === 'none') return; // Skip hidden rows
        const cells = row.querySelectorAll('td');
        // Defensive: skip if row has fewer cells than expected
        if (cells.length <= Math.max(commonWordIdx, translationIdx)) return;
        const commonWord = cells[commonWordIdx].innerText.replace(/"/g, '""');
        const translation = cells[translationIdx].innerText.replace(/"/g, '""');
        csvRows.push(`"${commonWord}","${translation}"`);
    });

    // Create CSV file and trigger download
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'word-data.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

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
