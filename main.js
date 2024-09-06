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

async function fetchTrackDetails(trackId, accessToken) {
  const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  const data = await response.json();
  return data;
}

async function fetchISRC(trackId, accessToken) {
  const trackDetails = await fetchTrackDetails(trackId, accessToken);
  return trackDetails.external_ids.isrc;
}

async function fetchWordsFromDatabase(isrcCodes) {
  console.log('Sending ISRC codes:', isrcCodes);
  try {
    const response = await fetch('/api/words', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isrcCodes }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching words from database:', error);
    throw error;
  }
}

async function displayTracksAndWords(tracks, accessToken) {
    const container = document.getElementById('recently-played');
    container.innerHTML = ''; // Clear the container

    // Create and add the dynamic header
    const header = document.createElement('h2');
    header.textContent = "Recently Played Tracks:";
    container.appendChild(header);

    // Create a table
    const table = document.createElement('table');
    const tableHeader = `
        <tr>
            <th>Title</th>
            <th>Artist</th>
            <th>Common French Words</th>
            <th>Add to wordNab</th>
        </tr>`;
    table.innerHTML = tableHeader;
    container.appendChild(table);

    const isrcCodes = [];
    const trackDetails = [];

    // Sort tracks by played_at timestamp in descending order (most recent first)
    tracks.sort((a, b) => new Date(b.played_at) - new Date(a.played_at));

    for (const item of tracks) {
        const trackId = item.track.id;
        const isrc = await fetchISRC(trackId, accessToken);
        isrcCodes.push(isrc);
        trackDetails.push({ isrc, item });
    }

    if (isrcCodes.length > 0) {
        const response = await fetchWordsFromDatabase(isrcCodes);
        const validIsrcs = new Set(response.valid_isrcs); // Use a Set for quick lookup

        for (const { isrc, item } of trackDetails) {
            const row = document.createElement('tr');

            // Title
            const titleCell = document.createElement('td');
            titleCell.textContent = item.track.name;
            row.appendChild(titleCell);

            // Artist
            const artistCell = document.createElement('td');
            artistCell.textContent = item.track.artists[0].name;
            row.appendChild(artistCell);

            // Common French Words
            const wordsCell = document.createElement('td');
            if (validIsrcs.has(isrc)) {
                const wordsForTrack = response.words
                    .filter(wordObj => wordObj.isrc === isrc)
                    .map(wordObj => wordObj.word);
                wordsCell.textContent = wordsForTrack.join(', ');
            } else {
                wordsCell.textContent = ''; // No words if ISRC is not valid
            }
            row.appendChild(wordsCell);

            // Add to wordNab
            const addToWordNabCell = document.createElement('td');
            if (!validIsrcs.has(isrc)) {
                const addButton = document.createElement('button');
                addButton.textContent = '+';
                addButton.onclick = () => {
                    sendEmailNotification(item.track.name, item.track.artists[0].name);
                };
                addToWordNabCell.appendChild(addButton);
            }
            row.appendChild(addToWordNabCell);

            table.appendChild(row);
        }

      // Aggregate words to remove duplicates
      const wordMap = {};
      response.words.forEach(wordObj => {
          if (wordMap[wordObj.word]) {
              wordMap[wordObj.word].total_count += wordObj.total_count;
          } else {
              wordMap[wordObj.word] = { ...wordObj };
          }
      });

      // Convert the aggregated word map back to an array
      const aggregatedWords = Object.values(wordMap).slice(0, 30); // Limit # of words in TreeMap

      createTreeMap(aggregatedWords);
      setupDownloadButton(aggregatedWords);
      } else {
      const noTracksMsg = document.createElement('p');
      noTracksMsg.textContent = "No recently played tracks found.";
      container.appendChild(noTracksMsg);
      }
}

function sendEmailNotification(trackName, artistName) {
    const email = 'micahjthompson1@gmail.com';
    const subject = 'Request to Add Track to Database';
    const body = `Please add the track "${trackName}" by ${artistName} to the database.`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function createTreeMap(words) {
    const width = document.getElementById('treemap').clientWidth;
    const height = 500;

    const treemap = d3.treemap()
        .size([width, height])
        .padding(1)
        .round(true);

    const svg = d3.select("#treemap")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    function updateTreeMap() {
        const data = {
            name: "Words",
            children: words.map(word => ({
                name: word.word,
                translation: word.translation,
                value: word.total_count
            }))
        };

        const root = d3.hierarchy(data)
            .sum(d => d.value)
            .sort((a, b) => b.value - a.value);

        treemap(root);

        svg.selectAll("g").remove();

        const cell = svg.selectAll("g")
            .data(root.leaves())
            .enter().append("g")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        cell.append("rect")
            .attr("width", d => d.x1 - d.x0)
            .attr("height", d => d.y1 - d.y0)
            .attr("fill", "steelblue")
            .attr("class", "treemap-rect") // Add the CSS class here
            .on("click", function(event, d) {
                const index = words.findIndex(word => word.word === d.data.name);
                if (index !== -1) {
                    words.splice(index, 1);
                    updateTreeMap();
                }
            });

        cell.each(function(d) {
            const group = d3.select(this);
            const cellWidth = d.x1 - d.x0;
            const cellHeight = d.y1 - d.y0;
            const padding = 4;
            const fontSize = Math.min(cellWidth, cellHeight) / 6;

            const text = group.append("text")
                .attr("fill", "white")
                .attr("font-size", fontSize)
                .attr("font-family", "Arial, sans-serif");

            const wordText = text.append("tspan")
                .attr("x", padding)
                .attr("y", fontSize + padding)
                .text(d.data.name);

            const translationText = text.append("tspan")
                .attr("x", padding)
                .attr("dy", fontSize * 1.2)
                .text(`(${d.data.translation})`);

            const textBBox = text.node().getBBox();
            if (textBBox.width > cellWidth - padding * 2 || textBBox.height > cellHeight - padding * 2) {
                translationText.remove();
                if (wordText.node().getComputedTextLength() > cellWidth - padding * 2) {
                    let truncatedText = d.data.name;
                    while (wordText.node().getComputedTextLength() > cellWidth - padding * 2 && truncatedText.length > 0) {
                        truncatedText = truncatedText.slice(0, -1);
                        wordText.text(truncatedText + '...');
                    }
                }
            }
        });
    }

    updateTreeMap();
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