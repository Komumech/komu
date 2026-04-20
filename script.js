const searchInput = document.getElementById('search-input');
const clearBtn = document.getElementById('clear-btn');
const suggestionsOverlay = document.getElementById('search-suggestions');
const resultsList = document.getElementById('results-list');
const imagesList = document.getElementById('images-list');
const aiOverview = document.getElementById('ai-overview');
const aiContent = document.getElementById('ai-content');
const aiShowMore = document.getElementById('ai-show-more');
const aiSources = document.getElementById('ai-sources');
const homeBtn = document.getElementById('home-btn');
const API_BASE = window.location.origin;
let currentQuery = "";
let fullAIResponse = "";

// Handle Overlay Visibility
searchInput.addEventListener('focus', () => {
    suggestionsOverlay.classList.remove('hidden');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-container')) {
        suggestionsOverlay.classList.add('hidden');
    }
});

// Handle Clear Button Visibility
searchInput.addEventListener('input', (e) => {
    clearBtn.classList.toggle('hidden', e.target.value.length === 0);
});

function clearSearch() {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    searchInput.focus();
}

clearBtn.addEventListener('click', clearSearch);
homeBtn.addEventListener('click', () => {
    window.location.reload();
});

// Simulation: Trigger search on Enter
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value;
        const activeTab = document.querySelector('.tab.active').dataset.tab;
        performSearch(query, activeTab);
    }
});

async function performSearch(query, type = "all") {
    if (!query) return;
    currentQuery = query;
    suggestionsOverlay.classList.add('hidden');
    document.body.classList.remove('is-home');
    
    // UI Loading State
    if (type === "all") {
        resultsList.innerHTML = '<div class="loading-shimmer">Searching...</div>';
        imagesList.classList.add('hidden');
        resultsList.classList.remove('hidden');
        aiOverview.classList.remove('hidden');
        aiContent.innerText = "Generating AI Overview...";
        aiSources.innerHTML = "";
        aiShowMore.classList.add('hidden');
    } else {
        imagesList.innerHTML = '<div class="loading-shimmer">Finding images...</div>';
        resultsList.classList.add('hidden');
        imagesList.classList.remove('hidden');
        aiOverview.classList.add('hidden');
    }

    try {
        const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}`);
        const data = await response.json();

        if (type === "all") {
            resultsList.innerHTML = "";
            if (!data.results || data.results.length === 0) {
                resultsList.innerHTML = "<p>No results found.</p>";
                return;
            }
            data.results.forEach(res => {
                resultsList.insertAdjacentHTML('beforeend', `
                    <div class="result-card">
                        <div class="site-info">
                            <img class="favicon" src="https://www.google.com/s2/favicons?sz=64&domain=${res.domain}">
                            <div class="site-header-text">
                                <div class="site-name">${res.domain}</div>
                                <div class="site-url">${res.url}</div>
                            </div>
                        </div>
                        <a href="${res.url}" target="_blank" class="result-title">${res.title}</a>
                        <div class="result-snippet">${res.snippet}</div>
                    </div>
                `);
            });

            // Populate AI Sources chips
            aiSources.innerHTML = data.results.slice(0, 3).map(res => 
                `<a href="${res.url}" target="_blank" class="source-chip">${res.domain}</a>`
            ).join('');

            const context = data.results.slice(0, 5).map(r => r.snippet).join(" ");
            const aiRes = await fetch(`${API_BASE}/ai-overview?q=${encodeURIComponent(query)}&context=${encodeURIComponent(context)}`);
            const aiData = await aiRes.json();
            fullAIResponse = aiData.overview;
            
            if (fullAIResponse.length > 400) {
                aiContent.innerText = fullAIResponse.substring(0, 400) + "...";
                aiShowMore.classList.remove('hidden');
            } else {
                aiContent.innerText = fullAIResponse;
            }
        } else {
            imagesList.innerHTML = "";
            data.results.forEach(res => {
                imagesList.insertAdjacentHTML('beforeend', `
                    <div class="image-card">
                        <a href="${res.url}" target="_blank"><img src="${res.url}"></a>
                    </div>
                `);
            });
        }
    } catch (err) {
        resultsList.innerHTML = `<div class="error">⚠️ Connection Error: Ensure main.py is running.</div>`;
    }
}

aiShowMore.addEventListener('click', () => {
    aiContent.innerText = fullAIResponse;
    aiShowMore.classList.add('hidden');
});

// Tab Switching Logic
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelector('.tab.active').classList.remove('active');
        tab.classList.add('active');
        performSearch(currentQuery, tab.dataset.tab);
    });
});