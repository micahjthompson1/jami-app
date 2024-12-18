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
        const corsProxy = 'https://cors-anywhere.herokuapp.com/';
        const apiUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
        const response = await fetch(corsProxy + apiUrl);
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