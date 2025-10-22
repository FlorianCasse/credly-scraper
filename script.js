// State management
let badges = [];
let processedBadges = [];

// DOM elements
const profileUrlInput = document.getElementById('profile-url');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const fetchBtn = document.getElementById('fetch-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const errorMessage = document.getElementById('error-message');
const infoMessage = document.getElementById('info-message');
const resultsSection = document.getElementById('results-section');
const badgesGrid = document.getElementById('badges-grid');
const badgeCount = document.getElementById('badge-count');
const btnText = fetchBtn.querySelector('.btn-text');
const spinner = fetchBtn.querySelector('.spinner');

// Event listeners
fetchBtn.addEventListener('click', handleFetchBadges);
downloadAllBtn.addEventListener('click', handleDownloadAll);

// Extract username from Credly URL
function extractUsername(url) {
    const match = url.match(/credly\.com\/users\/([^\/]+)/);
    if (!match) {
        throw new Error('Invalid Credly profile URL format. Expected: https://www.credly.com/users/username');
    }
    return match[1];
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
    let page = 1;
    const perPage = 100;

    while (true) {
        // Use CORS proxy for development, direct for GitHub Pages
        const apiUrl = `https://www.credly.com/users/${username}/badges.json?page=${page}&per_page=${perPage}`;

        // Try multiple CORS proxy options
        const corsProxies = [
            '', // Try direct first (works on GitHub Pages)
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
        ];

        let lastError = null;

        for (const proxy of corsProxies) {
            try {
                const url = proxy + encodeURIComponent(apiUrl);
                const response = await fetch(proxy ? url : apiUrl);

                if (!response.ok) {
                    throw new Error('Failed to fetch badges. User may not exist or profile is private.');
                }

                const data = await response.json();

                if (!data.data || data.data.length === 0) {
                    return allBadges;
                }

                allBadges.push(...data.data);

                // Check if there are more pages
                if (!data.metadata || !data.metadata.has_more) {
                    return allBadges;
                }

                page++;
                break; // Success, continue with next page using same proxy
            } catch (error) {
                lastError = error;
                // Try next proxy
                continue;
            }
        }

        // If all proxies failed, throw error
        if (lastError && allBadges.length === 0) {
            throw new Error(`Failed to fetch badges: ${lastError.message}. CORS may be blocking the request.`);
        }
    }

    return allBadges;
}

// Load and process image
async function loadAndProcessImage(imageUrl, targetWidth, targetHeight) {
    // Try to load image with different strategies
    const strategies = [
        // Strategy 1: Direct load with crossOrigin
        () => loadImageDirect(imageUrl),
        // Strategy 2: Fetch through CORS proxy and convert to blob
        () => loadImageViaProxy(imageUrl),
    ];

    let lastError = null;

    for (const strategy of strategies) {
        try {
            const img = await strategy();
            return processImage(img, targetWidth, targetHeight);
        } catch (error) {
            lastError = error;
            continue;
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
                img.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    resolve(img);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('Proxy load failed'));
                };
                img.src = objectUrl;
            });
        } catch (error) {
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

    // Calculate scaling to fit within target dimensions while maintaining aspect ratio
    const scale = Math.min(
        targetWidth / img.width,
        targetHeight / img.height
    );

    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;

    // Calculate position to center the image
    const x = (targetWidth - scaledWidth) / 2;
    const y = (targetHeight - scaledHeight) / 2;

    // Clear canvas (transparent background)
    ctx.clearRect(0, 0, targetWidth, targetHeight);

    // Draw image centered
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
        const container = card.querySelector('.badge-image-container');
        container.appendChild(canvas);
    }

    // Add event listeners
    const downloadBtn = card.querySelector('.download-btn');
    const viewBtn = card.querySelector('.view-original-btn');

    downloadBtn.addEventListener('click', () => handleDownloadSingle(index, badgeName));
    viewBtn.addEventListener('click', () => window.open(badge.image_url, '_blank'));

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

// Handle fetch badges
async function handleFetchBadges() {
    hideMessages();
    badgesGrid.innerHTML = '';
    resultsSection.style.display = 'none';
    badges = [];
    processedBadges = [];

    const profileUrl = profileUrlInput.value.trim();
    const targetWidth = parseInt(widthInput.value) || 512;
    const targetHeight = parseInt(heightInput.value) || 254;

    if (!profileUrl) {
        showError('Please enter a Credly profile URL');
        return;
    }

    try {
        setLoading(true);

        // Extract username
        const username = extractUsername(profileUrl);
        showInfo(`Fetching badges for user: ${username}...`);

        // Fetch badges
        badges = await fetchBadges(username);

        if (badges.length === 0) {
            showInfo('No badges found for this user.');
            setLoading(false);
            return;
        }

        showInfo(`Found ${badges.length} badges. Processing images...`);

        // Show results section
        resultsSection.style.display = 'block';
        badgeCount.textContent = `(${badges.length})`;

        // Process each badge
        for (let i = 0; i < badges.length; i++) {
            const badge = badges[i];
            const imageUrl = badge.image_url || badge.image?.url;

            if (!imageUrl) {
                console.warn('No image URL for badge:', badge);
                continue;
            }

            // Create placeholder card
            const card = createBadgeCard(badge, null, i);
            badgesGrid.appendChild(card);

            // Process image asynchronously
            try {
                const canvas = await loadAndProcessImage(imageUrl, targetWidth, targetHeight);
                processedBadges[i] = canvas;

                // Update card with processed image
                const container = card.querySelector('.badge-image-container');
                container.innerHTML = '';
                container.appendChild(canvas);
            } catch (error) {
                console.error('Error processing badge image:', error);
                const container = card.querySelector('.badge-image-container');
                container.innerHTML = '<div style="color: #dc3545; font-size: 0.875rem;">Failed to load</div>';
            }
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

        // Add each badge to ZIP
        for (let i = 0; i < badges.length; i++) {
            const canvas = processedBadges[i];
            if (!canvas) continue;

            const badge = badges[i];
            const badgeName = badge.badge_template?.name || badge.name || `badge_${i + 1}`;
            const filename = `${i + 1}_${sanitizeFilename(badgeName)}_processed.png`;

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            zip.file(filename, blob);
        }

        // Generate ZIP
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        // Download ZIP
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

// Allow Enter key to trigger fetch
profileUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleFetchBadges();
    }
});
