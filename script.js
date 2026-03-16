// State management
let badges = [];
let processedBadges = [];
let userDisplayNames = {}; // username -> "First Last"
const imageCache = new Map(); // imageUrl -> Promise<canvas> (deduplication)
let tabsDirty = false; // true when badges data changed since last tab render
let renderedTabs = { common: false, 'by-certification': false };

// Custom profiles from server API
let cachedCustomProfiles = null;

async function loadCustomProfiles() {
    try {
        const res = await fetch('/api/profiles');
        if (!res.ok) return {};
        cachedCustomProfiles = await res.json();
        return cachedCustomProfiles;
    } catch {
        return cachedCustomProfiles || {};
    }
}

// Merge predefined + custom profiles into one object
async function getAllProfiles() {
    const custom = await loadCustomProfiles();
    const merged = { ...PREDEFINED_PROFILES };
    for (const [country, urls] of Object.entries(custom)) {
        if (merged[country]) {
            const existing = new Set(merged[country].map(normalizeProfileUrl));
            for (const url of urls) {
                if (!existing.has(normalizeProfileUrl(url))) {
                    merged[country].push(url);
                }
            }
        } else {
            merged[country] = [...urls];
        }
    }
    return merged;
}

// Check if a country is entirely custom (not predefined)
function isCustomCountry(country) {
    return !PREDEFINED_PROFILES[country];
}

// Predefined profiles grouped by country
const PREDEFINED_PROFILES = {
    'France': [
        'https://www.credly.com/users/bouti-abdelkader',
        'https://www.credly.com/users/alangar',
        'https://www.credly.com/users/antoine-giraud.519d47bd',
        'https://www.credly.com/users/benjamin-yobe',
        'https://www.credly.com/users/florian-casse',
        'https://www.credly.com/users/hassan-ben-taher',
        'https://www.credly.com/users/hatem-bouzouita',
        'https://www.credly.com/users/karim-benmalek.6cb8ceb3',
        'https://www.credly.com/users/olivier-boulat.2c807e36',
        'https://www.credly.com/users/philippe-cheron.ab050cb5',
        'https://www.credly.com/users/sebastien-aucouturier',
        'https://www.credly.com/users/leonardo-coscia',
        'https://www.credly.com/users/vincent-taupenas',
        'https://www.credly.com/users/nicolas-pandjatcharam',
    ],
    'Belgium': [
        'https://www.credly.com/users/alexandre-francois.18d3df90',
        'https://www.credly.com/users/andy-ayite-zonor',
        'https://www.credly.com/users/igor-jemuce',
        'https://www.credly.com/users/jan-horrix',
        'https://www.credly.com/users/kevin-burgers',
        'https://www.credly.com/users/michael-van-de-gaer',
        'https://www.credly.com/users/michielpeene',
        'https://www.credly.com/users/stijnvermoesen',
        'https://www.credly.com/users/sven-cranshoff',
        'https://www.credly.com/users/wannes-de-boodt',
        'https://www.credly.com/users/yason-prufer',
    ],
    'Luxembourg': [
        'https://www.credly.com/users/amaury-sobaco.abfaee41',
        'https://www.credly.com/users/davy-stoffel',
        'https://www.credly.com/users/franki-sohmoe-kamte',
        'https://www.credly.com/users/miguel-brasseur.18fd467e',
        'https://www.credly.com/users/sestegra',
        'https://www.credly.com/users/valentin-collin.88f97edb',
    ],
    'Germany': [
        'https://www.credly.com/users/malte-wilhelm',
    ],
    'Netherlands': [
        'https://www.credly.com/users/albin-qorri.fcfad0f5',
        'https://www.credly.com/users/arie-jan-bodde',
        'https://www.credly.com/users/bart-lievers',
        'https://www.credly.com/users/bart-mulder',
        'https://www.credly.com/users/bavo-van-der-krieken.62003c0a',
        'https://www.credly.com/users/danny-rotmeijer',
        'https://www.credly.com/users/davy-van-de-laar.906902d4',
        'https://www.credly.com/users/ddejong',
        'https://www.credly.com/users/dennis-lefeber',
        'https://www.credly.com/users/dennis-mertens',
        'https://www.credly.com/users/dirk-jan-alken',
        'https://www.credly.com/users/eric-honcoop',
        'https://www.credly.com/users/eric-sloof',
        'https://www.credly.com/users/erik-verbruggen',
        'https://www.credly.com/users/gemma-van-der-voorst',
        'https://www.credly.com/users/hans-lenze-kaper.76804f63',
        'https://www.credly.com/users/jeroen-buren',
        'https://www.credly.com/users/kabir-ali.62af15df',
        'https://www.credly.com/users/luuk-giesbers.91b12124',
        'https://www.credly.com/users/mitchel-van-ballegooij',
        'https://www.credly.com/users/paul-van-dieen',
        'https://www.credly.com/users/rick-verstegen',
        'https://www.credly.com/users/robert-cranendonk',
        'https://www.credly.com/users/robin-van-altena',
        'https://www.credly.com/users/sam-vieillard',
        'https://www.credly.com/users/sjaak-bakker',
        'https://www.credly.com/users/toine-eetgerink',
        'https://www.credly.com/users/vincent-jansen.29312768',
        'https://www.credly.com/users/vincent-van-vierzen',
        'https://www.credly.com/users/wesley-van-ede',
        'https://www.credly.com/users/wesley-geelhoed',
    ],
};

// DOM elements
const profileUrlInput = document.getElementById('profile-url');
const filterKeywordInput = document.getElementById('filter-keyword');
const filterDateInput = document.getElementById('filter-date');
const fetchBtn = document.getElementById('fetch-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const errorMessage = document.getElementById('error-message');
const infoMessage = document.getElementById('info-message');
const resultsSection = document.getElementById('results-section');
const resultsTabsEl = document.getElementById('results-tabs');
const commonGrid = document.getElementById('common-grid');
const certificationGrid = document.getElementById('certification-grid');
const badgesGrid = document.getElementById('badges-grid');
const badgeCount = document.getElementById('badge-count');
const btnText = fetchBtn.querySelector('.btn-text');
const spinner = fetchBtn.querySelector('.spinner');

// Event listeners
fetchBtn.addEventListener('click', handleFetchBadges);
downloadAllBtn.addEventListener('click', handleDownloadAll);
exportCsvBtn.addEventListener('click', handleExportCSV);
resultsTabsEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) showTab(e.target.dataset.tab);
});

// Creates a concurrency limiter: at most `max` async tasks run simultaneously
function createConcurrencyLimiter(max) {
    let running = 0;
    const queue = [];
    return function limit(fn) {
        return new Promise((resolve, reject) => {
            const run = async () => {
                running++;
                try { resolve(await fn()); }
                catch (e) { reject(e); }
                finally {
                    running--;
                    if (queue.length > 0) queue.shift()();
                }
            };
            if (running < max) run();
            else queue.push(run);
        });
    };
}

// Extract username from Credly URL
function extractUsername(url) {
    const match = url.match(/credly\.com\/users\/([^\/]+)/);
    if (!match) {
        throw new Error('Invalid Credly profile URL format. Expected: https://www.credly.com/users/username');
    }
    return match[1];
}

// Normalize a Credly URL to just the username for deduplication
function normalizeProfileUrl(url) {
    const match = url.trim().match(/credly\.com\/users\/([^\/\s#?]+)/i);
    return match ? match[1].toLowerCase() : url.trim().toLowerCase();
}

// Fetch a Credly URL through the server-side proxy
async function fetchCredly(credlyUrl) {
    const response = await fetch(`/api/credly?url=${encodeURIComponent(credlyUrl)}`);
    if (!response.ok) {
        throw new Error(`Credly request failed (${response.status})`);
    }
    return response;
}

// Fetch first/last name for a Credly username (best-effort, falls back to username)
async function fetchUserProfile(username) {
    try {
        const response = await fetchCredly(`https://www.credly.com/users/${username}.json`);
        const data = await response.json();
        const user = data.data;
        if (user) {
            const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
            return fullName || username;
        }
    } catch {
        // fall through
    }
    return username;
}

// Return true if the badge matches the keyword filter (case-insensitive)
function matchesKeyword(badge, keyword) {
    if (!keyword) return true;
    const kw = keyword.toLowerCase();
    const name = (badge.badge_template?.name || badge.name || '').toLowerCase();
    const issuer = (badge.badge_template?.issuer_org_name || '').toLowerCase();
    const description = (badge.badge_template?.description || '').toLowerCase();
    return name.includes(kw) || issuer.includes(kw) || description.includes(kw);
}

// Show/hide messages
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    infoMessage.style.display = 'none';
}

function showInfo(message) {
    infoMessage.textContent = message;
    infoMessage.style.display = 'block';
    errorMessage.style.display = 'none';
}

function hideMessages() {
    errorMessage.style.display = 'none';
    infoMessage.style.display = 'none';
}

// Set loading state
function setLoading(isLoading) {
    fetchBtn.disabled = isLoading;
    if (isLoading) {
        btnText.textContent = 'Fetching...';
        spinner.style.display = 'inline-block';
    } else {
        btnText.textContent = 'Fetch Badges';
        spinner.style.display = 'none';
    }
}

// Fetch badges from Credly API
async function fetchBadges(username) {
    const allBadges = [];
    let nextUrl = `https://www.credly.com/users/${username}/badges.json`;

    while (nextUrl) {
        try {
            const response = await fetchCredly(nextUrl);
            const data = await response.json();
            if (!data.data) break;

            allBadges.push(...data.data);
            nextUrl = data.metadata?.next_page_url || null;
        } catch (error) {
            if (allBadges.length === 0) {
                throw new Error(`Failed to fetch badges: ${error.message}`);
            }
            console.warn('Could not fetch all pages. Returning partial results.');
            break;
        }
    }

    return allBadges;
}

// Load and process image via server proxy
async function loadAndProcessImage(imageUrl, targetWidth, targetHeight) {
    const response = await fetchCredly(imageUrl);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const img = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
        img.src = objectUrl;
    });

    return processImage(img, targetWidth, targetHeight);
}

// Process image on canvas
function processImage(img, targetWidth, targetHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;
    const x = (targetWidth - scaledWidth) / 2;
    const y = (targetHeight - scaledHeight) / 2;

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

    return canvas;
}

// Create badge card element
function createBadgeCard(badge, canvas, index) {
    const card = document.createElement('div');
    card.className = 'badge-card';

    const badgeName = badge.badge_template?.name || badge.name || 'Unknown Badge';
    const issuedAt = badge.issued_at ? new Date(badge.issued_at).toLocaleDateString() : 'N/A';

    card.innerHTML = `
        <div class="badge-image-container">
            ${canvas ? '' : '<div class="spinner"></div>'}
        </div>
        <div class="badge-info">
            <div class="badge-name">${badgeName}</div>
            <div class="badge-meta">Issued: ${issuedAt}</div>
        </div>
        <div class="badge-actions">
            <button class="download-btn" data-index="${index}">Download PNG</button>
            <button class="view-original-btn" data-url="${badge.image_url}">View Original</button>
        </div>
    `;

    if (canvas) {
        card.querySelector('.badge-image-container').appendChild(canvas);
    }

    card.querySelector('.download-btn').addEventListener('click', () => handleDownloadSingle(index, badgeName));
    card.querySelector('.view-original-btn').addEventListener('click', () => window.open(badge.image_url, '_blank'));

    return card;
}

// Switch between "common" and "by-profile" tabs (lazy render)
function showTab(tabName) {
    resultsTabsEl.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('tab-btn--active', btn.dataset.tab === tabName);
    });
    commonGrid.style.display = tabName === 'common' ? 'grid' : 'none';
    certificationGrid.style.display = tabName === 'by-certification' ? 'block' : 'none';
    badgesGrid.style.display = tabName === 'by-profile' ? 'grid' : 'none';

    // Lazy render: only compute when tab is first shown or data changed
    if (tabName === 'common' && (tabsDirty || !renderedTabs.common)) {
        renderCommonCertifications();
        renderedTabs.common = true;
    }
    if (tabName === 'by-certification' && (tabsDirty || !renderedTabs['by-certification'])) {
        renderByCertification();
        renderedTabs['by-certification'] = true;
    }
    if (tabsDirty) tabsDirty = false;
}

// Build and render the "Common Certifications" view
function renderCommonCertifications() {
    commonGrid.innerHTML = '';

    const groups = new Map();
    for (let i = 0; i < badges.length; i++) {
        const badge = badges[i];
        const key = badge.badge_template?.id || badge.badge_template?.name || badge.name;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { badge, globalIndex: i, holders: new Set() });
        groups.get(key).holders.add(badge._username);
    }

    const shared = Array.from(groups.values())
        .filter(g => g.holders.size >= 2)
        .sort((a, b) => b.holders.size - a.holders.size);

    if (shared.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'no-common-msg';
        msg.textContent = 'No certifications in common between the selected profiles.';
        commonGrid.appendChild(msg);
        return;
    }

    for (const { badge, globalIndex, holders } of shared) {
        commonGrid.appendChild(createCommonCard(badge, globalIndex, holders));
    }
}

// Create a card for the Common Certifications view
function createCommonCard(badge, globalIndex, holders) {
    const card = document.createElement('div');
    card.className = 'badge-card';

    const badgeName = badge.badge_template?.name || badge.name || 'Unknown Badge';
    const issuer = badge.badge_template?.issuer_org_name || '';
    const holderCount = holders.size;
    const holdersHtml = Array.from(holders)
        .map(h => `<span class="holder-tag">${userDisplayNames[h] || h}</span>`)
        .join('');

    card.innerHTML = `
        <div class="badge-image-container"></div>
        <div class="badge-info">
            <div class="badge-name">${badgeName}</div>
            ${issuer ? `<div class="badge-meta">${issuer}</div>` : ''}
            <div class="badge-meta holders-count">${holderCount} ${holderCount === 1 ? 'person' : 'people'}</div>
        </div>
        <div class="holders-list">${holdersHtml}</div>
    `;

    const canvas = processedBadges[globalIndex];
    const container = card.querySelector('.badge-image-container');
    if (canvas) {
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.style.cssText = 'max-width:100%;max-height:100%;display:block;';
        container.appendChild(img);
    } else {
        container.innerHTML = '<div style="color:#dc3545;font-size:0.875rem;">Image not available</div>';
    }

    return card;
}

// Build and render the "By Certification" view as a simple table
function renderByCertification() {
    certificationGrid.innerHTML = '';

    const groups = new Map();
    for (let i = 0; i < badges.length; i++) {
        const badge = badges[i];
        const key = badge.badge_template?.id || badge.badge_template?.name || badge.name;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { badge, holders: new Set() });
        groups.get(key).holders.add(badge._username);
    }

    const sorted = Array.from(groups.values())
        .sort((a, b) => b.holders.size - a.holders.size);

    if (sorted.length === 0) {
        certificationGrid.innerHTML = '<p class="no-common-msg">No certifications found.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'certification-table';
    table.innerHTML = `
        <thead>
            <tr><th>Certification</th><th>Holders</th></tr>
        </thead>
        <tbody>
            ${sorted.map(({ badge, holders }) => {
                const name = badge.badge_template?.name || badge.name || 'Unknown';
                return `<tr><td>${name}</td><td>${holders.size}</td></tr>`;
            }).join('')}
        </tbody>
    `;
    certificationGrid.appendChild(table);
}

// Sanitize filename
function sanitizeFilename(name) {
    return name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/__+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 100);
}

// Render a single profile into its pre-created container (data already fetched)
async function renderOneProfile(username, displayName, rawBadges, container, keyword, filterDate, targetWidth, targetHeight, imageLimit) {
    userDisplayNames[username] = displayName;

    // Apply keyword + date filters
    let profileBadges = rawBadges.filter(b =>
        matchesKeyword(b, keyword) &&
        (!filterDate || (b.issued_at && new Date(b.issued_at) >= filterDate))
    );

    // Render profile header
    const header = document.createElement('div');
    header.className = 'profile-header';
    header.textContent = profileBadges.length === 0
        ? `${displayName} — No badges${keyword ? ` matching "${keyword}"` : ' found'}`
        : `${displayName} (${profileBadges.length} badge${profileBadges.length !== 1 ? 's' : ''}${keyword ? ` matching "${keyword}"` : ''})`;
    container.appendChild(header);

    if (profileBadges.length === 0) return;

    // Tag each badge with its profile username
    profileBadges.forEach(b => { b._username = username; });

    // Reserve a contiguous block of indices in the global array (atomic in JS — no await between read and push)
    const startIndex = badges.length;
    badges.push(...profileBadges);

    // Pre-create all cards in order so DOM order is deterministic regardless of image load timing
    const cards = profileBadges.map((badge, i) => {
        const card = createBadgeCard(badge, null, startIndex + i);
        container.appendChild(card);
        return card;
    });

    // Load and process all images in parallel (capped by the shared imageLimit)
    await Promise.all(profileBadges.map((badge, i) =>
        imageLimit(async () => {
            const globalIndex = startIndex + i;
            const imageUrl = badge.image_url || badge.image?.url;
            const imgContainer = cards[i].querySelector('.badge-image-container');

            if (!imageUrl) {
                imgContainer.innerHTML = '';
                return;
            }

            try {
                // Deduplicate: reuse in-flight or resolved promise for same image URL
                let canvasPromise = imageCache.get(imageUrl);
                if (!canvasPromise) {
                    canvasPromise = loadAndProcessImage(imageUrl, targetWidth, targetHeight);
                    imageCache.set(imageUrl, canvasPromise);
                }
                const originalCanvas = await canvasPromise;

                // Clone canvas since each card needs its own DOM node
                const canvas = document.createElement('canvas');
                canvas.width = originalCanvas.width;
                canvas.height = originalCanvas.height;
                canvas.getContext('2d').drawImage(originalCanvas, 0, 0);

                processedBadges[globalIndex] = canvas;
                imgContainer.innerHTML = '';
                imgContainer.appendChild(canvas);
            } catch {
                imgContainer.innerHTML = '<div style="color:#dc3545;font-size:0.875rem;">Failed to load</div>';
            }

            // Update running total as images resolve
            badgeCount.textContent = `(${badges.length})`;
        })
    ));
}

// Handle fetch badges (SSE streaming)
async function handleFetchBadges() {
    hideMessages();
    badgesGrid.innerHTML = '';
    commonGrid.innerHTML = '';
    certificationGrid.innerHTML = '';
    resultsTabsEl.style.display = 'none';
    badgesGrid.style.display = 'grid';
    resultsSection.style.display = 'none';
    badges = [];
    imageCache.clear();
    processedBadges = [];
    userDisplayNames = {};
    tabsDirty = false;
    renderedTabs = { common: false, 'by-certification': false };

    const rawInput = profileUrlInput.value.trim();
    const keyword = filterKeywordInput.value.trim();
    const filterDate = filterDateInput.value ? new Date(filterDateInput.value) : null;
    const targetWidth = 512;
    const targetHeight = 254;

    if (!rawInput) {
        showError('Please enter at least one Credly profile URL');
        return;
    }

    const lines = rawInput.split('\n').map(l => l.trim()).filter(Boolean);

    const usernames = [];
    const invalidLines = [];
    for (const line of lines) {
        try {
            usernames.push(extractUsername(line));
        } catch {
            invalidLines.push(line);
        }
    }

    if (usernames.length === 0) {
        showError('No valid Credly profile URLs found.');
        return;
    }

    if (invalidLines.length > 0) {
        showInfo(`${invalidLines.length} invalid URL(s) skipped. Fetching ${usernames.length} profile(s)...`);
    }

    try {
        setLoading(true);
        resultsSection.style.display = 'block';
        showInfo(`Fetching ${usernames.length} profile${usernames.length !== 1 ? 's' : ''} from server...`);

        const imageLimit = createConcurrencyLimiter(10);

        // Pre-create one container div per profile to preserve display order
        const profileContainers = {};
        for (const username of usernames) {
            const div = document.createElement('div');
            badgesGrid.appendChild(div);
            profileContainers[username] = div;
        }

        // Track render promises to wait for all images
        const renderPromises = [];
        let profilesReceived = 0;

        // Stream profiles via SSE
        await new Promise((resolve, reject) => {
            const url = `/api/batch-badges-stream?usernames=${encodeURIComponent(usernames.join(','))}`;
            const eventSource = new EventSource(url);

            eventSource.onmessage = (event) => {
                const result = JSON.parse(event.data);
                profilesReceived++;
                showInfo(`Received ${profilesReceived}/${usernames.length} profiles...`);

                const container = profileContainers[result.username];
                if (!container) return;

                if (result.error) {
                    const errHeader = document.createElement('div');
                    errHeader.className = 'profile-header profile-header--error';
                    errHeader.textContent = `${result.username} — Failed: ${result.error}`;
                    container.appendChild(errHeader);
                    return;
                }

                const promise = renderOneProfile(
                    result.username, result.displayName, result.badges,
                    container,
                    keyword, filterDate,
                    targetWidth, targetHeight,
                    imageLimit
                ).then(() => {
                    tabsDirty = true;
                    badgeCount.textContent = `(${badges.length})`;

                    // Show tabs as soon as 2+ profiles have results
                    const distinctProfiles = new Set(badges.map(b => b._username).filter(Boolean)).size;
                    if (distinctProfiles >= 2 && resultsTabsEl.style.display !== 'flex') {
                        resultsTabsEl.style.display = 'flex';
                        showTab('common');
                    }
                }).catch(err => {
                    const errHeader = document.createElement('div');
                    errHeader.className = 'profile-header profile-header--error';
                    errHeader.textContent = `${result.username} — Failed: ${err.message}`;
                    container.appendChild(errHeader);
                });
                renderPromises.push(promise);
            };

            eventSource.addEventListener('done', () => {
                eventSource.close();
                resolve();
            });

            eventSource.onerror = () => {
                eventSource.close();
                // If we received nothing, fall back to POST endpoint
                if (profilesReceived === 0) {
                    reject(new Error('SSE stream failed'));
                } else {
                    resolve(); // partial success
                }
            };
        });

        // Wait for all in-flight image renders to complete
        await Promise.allSettled(renderPromises);

        badgeCount.textContent = `(${badges.length})`;

        // Final tab state: show tabs if 2+ profiles, and re-render active tab
        const distinctProfiles = new Set(badges.map(b => b._username).filter(Boolean)).size;
        if (distinctProfiles >= 2) {
            tabsDirty = true;
            resultsTabsEl.style.display = 'flex';
            const activeTab = getActiveTab();
            showTab(activeTab === 'by-profile' ? 'common' : activeTab);
        }

        hideMessages();
        setLoading(false);

    } catch (error) {
        // Fallback to POST batch endpoint
        try {
            const imageLimit = createConcurrencyLimiter(10);
            const res = await fetch('/api/batch-badges', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames }),
            });
            if (!res.ok) throw new Error('Batch fetch failed');
            const batchResults = await res.json();

            for (const result of batchResults) {
                const container = document.createElement('div');
                badgesGrid.appendChild(container);
                if (result.error) {
                    const errHeader = document.createElement('div');
                    errHeader.className = 'profile-header profile-header--error';
                    errHeader.textContent = `${result.username} — Failed: ${result.error}`;
                    container.appendChild(errHeader);
                    continue;
                }
                await renderOneProfile(
                    result.username, result.displayName, result.badges,
                    container, keyword, filterDate,
                    targetWidth, targetHeight, imageLimit
                );
            }

            badgeCount.textContent = `(${badges.length})`;
            const distinctProfiles = new Set(badges.map(b => b._username).filter(Boolean)).size;
            if (distinctProfiles >= 2) {
                tabsDirty = true;
                resultsTabsEl.style.display = 'flex';
                showTab('common');
            }
            hideMessages();
        } catch (fallbackError) {
            showError(fallbackError.message);
        }
        setLoading(false);
    }
}

// Download single badge
async function handleDownloadSingle(index, badgeName) {
    const canvas = processedBadges[index];
    if (!canvas) {
        showError('Image not yet processed');
        return;
    }

    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFilename(badgeName)}_processed.png`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        showError('Failed to download image');
        console.error(error);
    }
}

// Download all badges as ZIP
async function handleDownloadAll() {
    if (processedBadges.length === 0) {
        showError('No badges to download');
        return;
    }

    try {
        downloadAllBtn.disabled = true;
        downloadAllBtn.textContent = 'Creating ZIP...';

        const zip = new JSZip();

        for (let i = 0; i < badges.length; i++) {
            const canvas = processedBadges[i];
            if (!canvas) continue;

            const badge = badges[i];
            const username = badge._username || 'unknown';
            const badgeName = badge.badge_template?.name || badge.name || `badge_${i + 1}`;
            const filename = `${username}/${i + 1}_${sanitizeFilename(badgeName)}_processed.png`;

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            zip.file(filename, blob);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'credly_badges_processed.zip';
        a.click();
        URL.revokeObjectURL(url);

        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = 'Download All as ZIP';

    } catch (error) {
        showError('Failed to create ZIP file');
        console.error(error);
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = 'Download All as ZIP';
    }
}

// Escape a value for CSV
function escapeCSV(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// Get the currently active tab name
function getActiveTab() {
    const activeBtn = resultsTabsEl.querySelector('.tab-btn--active');
    return activeBtn ? activeBtn.dataset.tab : 'by-profile';
}

// Export badge list as CSV (adapts to active tab)
function handleExportCSV() {
    if (badges.length === 0) {
        showError('No badges to export');
        return;
    }

    if (getActiveTab() === 'by-certification') {
        return exportCertificationCSV();
    }

    const headers = ['Profile', 'Name', 'Issuer', 'Issued At', 'Expires At', 'Badge URL', 'Image URL'];

    const rows = badges.map(badge => {
        const profile = badge._username || '';
        const name = badge.badge_template?.name || badge.name || '';
        const issuer = badge.badge_template?.issuer_org_name || '';
        const issuedAt = badge.issued_at ? new Date(badge.issued_at).toLocaleDateString() : '';
        const expiresAt = badge.expires_at ? new Date(badge.expires_at).toLocaleDateString() : '';
        const badgeUrl = badge.id ? `https://www.credly.com/badges/${badge.id}` : '';
        const imageUrl = badge.image_url || '';

        return [profile, name, issuer, issuedAt, expiresAt, badgeUrl, imageUrl].map(escapeCSV);
    });

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    downloadCSV(csv, 'credly_badges.csv');
}

// Export By Certification view as CSV (certification name + holder count)
function exportCertificationCSV() {
    const groups = new Map();
    for (const badge of badges) {
        const key = badge.badge_template?.id || badge.badge_template?.name || badge.name;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { badge, holders: new Set() });
        groups.get(key).holders.add(badge._username);
    }

    const sorted = Array.from(groups.values()).sort((a, b) => b.holders.size - a.holders.size);

    const headers = ['Certification', 'Holders'];
    const rows = sorted.map(({ badge, holders }) => {
        const name = badge.badge_template?.name || badge.name || 'Unknown';
        return [escapeCSV(name), holders.size];
    });

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    downloadCSV(csv, 'credly_certifications.csv');
}

// Helper to trigger CSV download
function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Update the textarea to reflect the current checkbox selection
async function updateTextareaFromCheckboxes() {
    const allProfiles = await getAllProfiles();
    const allKnownUsernames = new Set(
        Object.values(allProfiles).flat().map(normalizeProfileUrl)
    );

    const currentLines = profileUrlInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    const manualLines = currentLines.filter(l => !allKnownUsernames.has(normalizeProfileUrl(l)));

    const countryLines = [];
    for (const [country, urls] of Object.entries(allProfiles)) {
        const checkbox = document.querySelector(`.country-pill[data-country="${CSS.escape(country)}"] input[type="checkbox"]`);
        if (checkbox?.checked) countryLines.push(...urls);
    }

    profileUrlInput.value = [...manualLines, ...countryLines].join('\n');
}

// Render country pill checkboxes from merged profiles
async function initQuickSelect() {
    const container = document.getElementById('quick-select');
    if (!container) return;
    container.innerHTML = '';

    const title = document.createElement('p');
    title.className = 'quick-select-title';
    title.textContent = 'Quick select by country';
    container.appendChild(title);

    const pills = document.createElement('div');
    pills.className = 'country-pills';
    container.appendChild(pills);

    const allProfiles = await getAllProfiles();
    for (const [country, urls] of Object.entries(allProfiles)) {
        const label = document.createElement('label');
        label.className = 'country-pill' + (isCustomCountry(country) ? ' country-pill--custom' : '');
        label.dataset.country = country;
        label.innerHTML = `
            <input type="checkbox">
            <span>${country}</span>
            <span class="country-pill-count">(${urls.length})</span>
        `;
        label.querySelector('input').addEventListener('change', updateTextareaFromCheckboxes);
        pills.appendChild(label);
    }

    // "Add Profile" button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-profile-btn';
    addBtn.innerHTML = '<span class="plus-icon">+</span> Add Profile';
    addBtn.addEventListener('click', openAddProfileModal);
    pills.appendChild(addBtn);

    // Render custom profiles list (removable)
    const custom = cachedCustomProfiles || {};
    const customEntries = Object.entries(custom).flatMap(([country, urls]) =>
        urls.map(url => ({ country, url }))
    );
    if (customEntries.length > 0) {
        const listContainer = document.createElement('div');
        listContainer.className = 'custom-profiles-list';

        const listTitle = document.createElement('p');
        listTitle.className = 'quick-select-title';
        listTitle.textContent = 'Your added profiles';
        listContainer.appendChild(listTitle);

        const list = document.createElement('div');
        list.className = 'custom-profiles-tags';
        for (const { country, url } of customEntries) {
            const username = url.match(/\/users\/([^\/\s#?]+)/i)?.[1] || url;
            const tag = document.createElement('span');
            tag.className = 'custom-profile-tag';
            tag.innerHTML = `
                <span class="custom-profile-tag-text">${username} <small>(${country})</small></span>
                <button type="button" class="custom-profile-remove" title="Remove this profile">&times;</button>
            `;
            tag.querySelector('.custom-profile-remove').addEventListener('click', () => {
                removeCustomProfile(country, url);
            });
            list.appendChild(tag);
        }
        listContainer.appendChild(list);
        container.appendChild(listContainer);
    }
}

// Remove a custom profile
async function removeCustomProfile(country, url) {
    const password = sessionPassword || prompt('Enter the password to remove a profile:');
    if (!password) return;

    try {
        const res = await fetch('/api/profiles', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, country, url }),
        });
        if (res.status === 401) {
            sessionPassword = null;
            alert('Incorrect password.');
            return;
        }
        if (!res.ok) { alert('Failed to remove profile.'); return; }
        sessionPassword = password;
    } catch {
        alert('Network error.');
        return;
    }

    await initQuickSelect();
    await updateTextareaFromCheckboxes();
}

// Password session cache (only lives in memory, never persisted)
let sessionPassword = null;

// Modal logic
async function openAddProfileModal() {
    const modal = document.getElementById('add-profile-modal');
    const countrySelect = document.getElementById('modal-country');
    const newCountryGroup = document.getElementById('new-country-group');
    const newCountryInput = document.getElementById('modal-new-country');
    const modalError = document.getElementById('modal-error');
    const profileUrlModalInput = document.getElementById('modal-profile-url');

    // Reset form
    profileUrlModalInput.value = '';
    newCountryInput.value = '';
    modalError.style.display = 'none';
    newCountryGroup.style.display = 'none';

    // Populate country dropdown
    const allProfiles = await getAllProfiles();
    countrySelect.innerHTML = '<option value="" disabled selected>Select a country...</option>';
    for (const country of Object.keys(allProfiles).sort()) {
        const opt = document.createElement('option');
        opt.value = country;
        opt.textContent = country;
        countrySelect.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Add a new country...';
    countrySelect.appendChild(newOpt);

    modal.showModal();
}

function initModal() {
    const modal = document.getElementById('add-profile-modal');
    const form = document.getElementById('add-profile-form');
    const countrySelect = document.getElementById('modal-country');
    const newCountryGroup = document.getElementById('new-country-group');
    const newCountryInput = document.getElementById('modal-new-country');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const modalError = document.getElementById('modal-error');

    // Show/hide new country input
    countrySelect.addEventListener('change', () => {
        const isNew = countrySelect.value === '__new__';
        newCountryGroup.style.display = isNew ? 'block' : 'none';
        newCountryInput.required = isNew;
    });

    // Cancel
    cancelBtn.addEventListener('click', () => modal.close());

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.close();
    });

    // Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('modal-profile-url').value.trim();
        const countryValue = countrySelect.value;
        const newCountry = newCountryInput.value.trim();

        // Validate URL
        if (!url.match(/credly\.com\/users\/[^\/\s]+/i)) {
            modalError.textContent = 'Please enter a valid Credly profile URL (e.g. https://www.credly.com/users/username)';
            modalError.style.display = 'block';
            return;
        }

        // Determine country
        let country;
        if (countryValue === '__new__') {
            if (!newCountry) {
                modalError.textContent = 'Please enter a country name.';
                modalError.style.display = 'block';
                return;
            }
            country = newCountry;
        } else {
            country = countryValue;
        }

        // Check for duplicate against full set (predefined + custom)
        const allProfiles = await getAllProfiles();
        const norm = normalizeProfileUrl(url);
        for (const [c, urls] of Object.entries(allProfiles)) {
            if (urls.some(u => normalizeProfileUrl(u) === norm)) {
                modalError.textContent = `This profile already exists under "${c}".`;
                modalError.style.display = 'block';
                return;
            }
        }

        // Ask for password if not yet cached
        const password = sessionPassword || prompt('Enter the password to add a profile:');
        if (!password) return;

        const fullUrl = url.match(/^https?:\/\//) ? url : `https://www.credly.com/users/${url}`;

        try {
            const res = await fetch('/api/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, country, url: fullUrl }),
            });

            if (res.status === 401) {
                sessionPassword = null;
                modalError.textContent = 'Incorrect password.';
                modalError.style.display = 'block';
                return;
            }
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                modalError.textContent = data.error || 'Failed to add profile.';
                modalError.style.display = 'block';
                return;
            }

            sessionPassword = password;
        } catch {
            modalError.textContent = 'Network error. Is the server running?';
            modalError.style.display = 'block';
            return;
        }

        modal.close();
        await initQuickSelect();
    });
}

// Ctrl+Enter (or Cmd+Enter on Mac) triggers fetch from the textarea
profileUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleFetchBadges();
    }
});

// Initialise quick-select checkboxes and modal on page load
initQuickSelect();
initModal();
