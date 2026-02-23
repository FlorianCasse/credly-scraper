// State management
let badges = [];
let processedBadges = [];
let userDisplayNames = {}; // username -> "First Last"

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
};

// DOM elements
const profileUrlInput = document.getElementById('profile-url');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
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

// Fetch first/last name for a Credly username (best-effort, falls back to username)
async function fetchUserProfile(username) {
    const profileUrl = `https://www.credly.com/users/${username}.json`;
    const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
    for (const proxy of corsProxies) {
        try {
            const url = proxy ? proxy + encodeURIComponent(profileUrl) : profileUrl;
            const response = await fetch(url);
            if (!response.ok) continue;
            const data = await response.json();
            const user = data.data;
            if (user) {
                const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
                return fullName || username;
            }
        } catch {
            continue;
        }
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

// Fetch badges from Credly API with sticky proxy (reuses the working proxy across pages)
async function fetchBadges(username) {
    const allBadges = [];
    let nextUrl = `https://www.credly.com/users/${username}/badges.json`;
    const allProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
    let stickyProxy = null; // Reuse the proxy that worked on the first page

    while (nextUrl) {
        // Try the known-good proxy first, then fall back to others
        const proxiesToTry = stickyProxy !== null
            ? [stickyProxy, ...allProxies.filter(p => p !== stickyProxy)]
            : allProxies;

        let success = false;
        let lastError = null;

        for (const proxy of proxiesToTry) {
            try {
                const url = proxy ? proxy + encodeURIComponent(nextUrl) : nextUrl;
                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error('Failed to fetch badges. User may not exist or profile is private.');
                }

                const data = await response.json();
                if (!data.data) break;

                allBadges.push(...data.data);
                nextUrl = data.metadata?.next_page_url || null;
                stickyProxy = proxy; // Remember this proxy for subsequent pages
                success = true;
                break;
            } catch (error) {
                lastError = error;
                continue;
            }
        }

        if (!success) {
            if (allBadges.length === 0) {
                throw new Error(`Failed to fetch badges: ${lastError?.message ?? 'Unknown error'}. CORS may be blocking the request.`);
            } else {
                console.warn('Could not fetch all pages. Returning partial results.');
                break;
            }
        }
    }

    return allBadges;
}

// Load and process image
async function loadAndProcessImage(imageUrl, targetWidth, targetHeight) {
    const strategies = [
        () => loadImageDirect(imageUrl),
        () => loadImageViaProxy(imageUrl),
    ];

    let lastError = null;
    for (const strategy of strategies) {
        try {
            const img = await strategy();
            return processImage(img, targetWidth, targetHeight);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Failed to load image');
}

// Direct image loading
function loadImageDirect(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Direct load failed'));
        img.src = imageUrl;
    });
}

// Load image via CORS proxy
async function loadImageViaProxy(imageUrl) {
    const proxies = [
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url=',
    ];

    for (const proxy of proxies) {
        try {
            const response = await fetch(proxy + encodeURIComponent(imageUrl));
            if (!response.ok) continue;

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
                img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Proxy load failed')); };
                img.src = objectUrl;
            });
        } catch {
            continue;
        }
    }

    throw new Error('All proxy attempts failed');
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

// Switch between "common" and "by-profile" tabs
function showTab(tabName) {
    resultsTabsEl.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('tab-btn--active', btn.dataset.tab === tabName);
    });
    commonGrid.style.display = tabName === 'common' ? 'grid' : 'none';
    badgesGrid.style.display = tabName === 'by-profile' ? 'grid' : 'none';
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

// Sanitize filename
function sanitizeFilename(name) {
    return name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/__+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 100);
}

// Fetch and render a single profile into its pre-created container
async function processOneProfile(username, container, keyword, filterDate, targetWidth, targetHeight, imageLimit) {
    // Fetch display name and all badge pages concurrently
    const [displayName, rawBadges] = await Promise.all([
        fetchUserProfile(username),
        fetchBadges(username),
    ]);

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
                const canvas = await loadAndProcessImage(imageUrl, targetWidth, targetHeight);
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

// Handle fetch badges
async function handleFetchBadges() {
    hideMessages();
    badgesGrid.innerHTML = '';
    commonGrid.innerHTML = '';
    resultsTabsEl.style.display = 'none';
    badgesGrid.style.display = 'grid';
    resultsSection.style.display = 'none';
    badges = [];
    processedBadges = [];
    userDisplayNames = {};

    const rawInput = profileUrlInput.value.trim();
    const keyword = filterKeywordInput.value.trim();
    const filterDate = filterDateInput.value ? new Date(filterDateInput.value) : null;
    const targetWidth = parseInt(widthInput.value) || 512;
    const targetHeight = parseInt(heightInput.value) || 254;

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
        showInfo(`Fetching ${usernames.length} profile${usernames.length !== 1 ? 's' : ''} in parallel...`);

        // Max 5 profiles fetched simultaneously, max 4 images loaded simultaneously
        const profileLimit = createConcurrencyLimiter(5);
        const imageLimit = createConcurrencyLimiter(4);

        // Pre-create one container div per profile to preserve display order
        // regardless of which profile finishes first
        const profileContainers = usernames.map(() => {
            const div = document.createElement('div');
            badgesGrid.appendChild(div);
            return div;
        });

        // Fetch and render all profiles in parallel
        await Promise.allSettled(
            usernames.map((username, i) =>
                profileLimit(() =>
                    processOneProfile(
                        username, profileContainers[i],
                        keyword, filterDate,
                        targetWidth, targetHeight,
                        imageLimit
                    ).catch(err => {
                        const errHeader = document.createElement('div');
                        errHeader.className = 'profile-header profile-header--error';
                        errHeader.textContent = `${username} — Failed: ${err.message}`;
                        profileContainers[i].appendChild(errHeader);
                    })
                )
            )
        );

        badgeCount.textContent = `(${badges.length})`;

        // Show Common Certifications tab if 2+ distinct profiles have results
        const distinctProfiles = new Set(badges.map(b => b._username).filter(Boolean)).size;
        if (distinctProfiles >= 2) {
            renderCommonCertifications();
            resultsTabsEl.style.display = 'flex';
            showTab('common');
        }

        hideMessages();
        setLoading(false);

    } catch (error) {
        showError(error.message);
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

// Export badge list as CSV
function handleExportCSV() {
    if (badges.length === 0) {
        showError('No badges to export');
        return;
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
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credly_badges.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Update the textarea to reflect the current checkbox selection
function updateTextareaFromCheckboxes() {
    const allPredefinedUsernames = new Set(
        Object.values(PREDEFINED_PROFILES).flat().map(normalizeProfileUrl)
    );

    const currentLines = profileUrlInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    const manualLines = currentLines.filter(l => !allPredefinedUsernames.has(normalizeProfileUrl(l)));

    const countryLines = [];
    for (const [country, urls] of Object.entries(PREDEFINED_PROFILES)) {
        const checkbox = document.querySelector(`.country-pill[data-country="${country}"] input`);
        if (checkbox?.checked) countryLines.push(...urls);
    }

    profileUrlInput.value = [...manualLines, ...countryLines].join('\n');
}

// Render country pill checkboxes from PREDEFINED_PROFILES
function initQuickSelect() {
    const container = document.getElementById('quick-select');
    if (!container) return;

    const title = document.createElement('p');
    title.className = 'quick-select-title';
    title.textContent = 'Quick select by country';
    container.appendChild(title);

    const pills = document.createElement('div');
    pills.className = 'country-pills';
    container.appendChild(pills);

    for (const [country, urls] of Object.entries(PREDEFINED_PROFILES)) {
        const label = document.createElement('label');
        label.className = 'country-pill';
        label.dataset.country = country;
        label.innerHTML = `
            <input type="checkbox">
            <span>${country}</span>
            <span class="country-pill-count">(${urls.length})</span>
        `;
        label.querySelector('input').addEventListener('change', updateTextareaFromCheckboxes);
        pills.appendChild(label);
    }
}

// Ctrl+Enter (or Cmd+Enter on Mac) triggers fetch from the textarea
profileUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleFetchBadges();
    }
});

// Initialise quick-select checkboxes on page load
initQuickSelect();
