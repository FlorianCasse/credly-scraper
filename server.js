const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3002;
const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';
const DATA_FILE = path.join(__dirname, 'data', 'custom-profiles.json');

app.use(express.json());
app.use(express.static(__dirname, { index: false, extensions: ['html', 'css', 'js'] }));

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Helpers ---

function readProfiles() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function writeProfiles(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function normalizeUrl(url) {
    const match = url.trim().match(/credly\.com\/users\/([^\/\s#?]+)/i);
    return match ? match[1].toLowerCase() : url.trim().toLowerCase();
}

// --- In-Memory Cache ---
const cache = new Map();
const MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB
const TTL_JSON = 60 * 60 * 1000;           // 1 hour
const TTL_IMAGE = 24 * 60 * 60 * 1000;     // 24 hours
let currentCacheBytes = 0;

function getCacheTTL(contentType) {
    if (contentType && contentType.startsWith('image/')) return TTL_IMAGE;
    return TTL_JSON;
}

function evictIfNeeded() {
    if (currentCacheBytes <= MAX_CACHE_BYTES) return;
    const entries = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    for (const [key, entry] of entries) {
        if (currentCacheBytes <= MAX_CACHE_BYTES) break;
        currentCacheBytes -= entry.size;
        cache.delete(key);
    }
}

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > getCacheTTL(entry.contentType)) {
        currentCacheBytes -= entry.size;
        cache.delete(key);
        return null;
    }
    entry.lastAccess = Date.now();
    return entry;
}

function setCache(key, buffer, contentType) {
    const existing = cache.get(key);
    if (existing) currentCacheBytes -= existing.size;
    const size = buffer.length;
    cache.set(key, { buffer, contentType, timestamp: Date.now(), lastAccess: Date.now(), size });
    currentCacheBytes += size;
    evictIfNeeded();
}

// --- Credly Proxy (with cache) ---
// Accepts ?url=<full credly URL> to support both www.credly.com and images.credly.com

const ALLOWED_CREDLY_HOSTS = ['www.credly.com', 'credly.com', 'images.credly.com'];

app.get('/api/credly', (req, res) => {
    const credlyUrl = req.query.url;
    if (!credlyUrl) return res.status(400).json({ error: 'Missing url parameter' });

    let parsed;
    try { parsed = new URL(credlyUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    if (!ALLOWED_CREDLY_HOSTS.includes(parsed.hostname)) {
        return res.status(403).json({ error: 'URL must be from credly.com' });
    }

    const cacheKey = credlyUrl;
    const cached = getCached(cacheKey);
    if (cached) {
        res.set('Content-Type', cached.contentType);
        res.set('X-Cache', 'HIT');
        return res.send(cached.buffer);
    }

    https.get(credlyUrl, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CredlyScraper/1.0)',
        }
    }, (upstream) => {
        if (upstream.statusCode !== 200) {
            res.status(upstream.statusCode);
            if (upstream.headers['content-type']) res.set('Content-Type', upstream.headers['content-type']);
            upstream.pipe(res);
            return;
        }
        const chunks = [];
        upstream.on('data', chunk => chunks.push(chunk));
        upstream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const contentType = upstream.headers['content-type'] || 'application/octet-stream';
            setCache(cacheKey, buffer, contentType);
            res.set('Content-Type', contentType);
            res.set('X-Cache', 'MISS');
            res.send(buffer);
        });
    }).on('error', (err) => {
        console.error('Credly proxy error:', err.message);
        res.status(502).json({ error: 'Failed to reach Credly' });
    });
});

app.get('/api/cache-stats', (req, res) => {
    res.json({
        entries: cache.size,
        sizeMB: (currentCacheBytes / (1024 * 1024)).toFixed(2),
        maxMB: (MAX_CACHE_BYTES / (1024 * 1024)).toFixed(0),
    });
});

// --- Profile API Routes ---

// Get all custom profiles (public, no auth needed)
app.get('/api/profiles', (req, res) => {
    res.json(readProfiles());
});

// Add a profile
app.post('/api/profiles', (req, res) => {
    const { password, country, url } = req.body;

    if (password !== PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password.' });
    }
    if (!country || typeof country !== 'string' || !country.trim()) {
        return res.status(400).json({ error: 'Country is required.' });
    }
    if (!url || !/credly\.com\/users\/[^\/\s]+/i.test(url)) {
        return res.status(400).json({ error: 'Invalid Credly profile URL.' });
    }

    const profiles = readProfiles();
    const norm = normalizeUrl(url);

    // Check for duplicate within custom profiles
    for (const [c, urls] of Object.entries(profiles)) {
        if (urls.some(u => normalizeUrl(u) === norm)) {
            return res.status(409).json({ error: `This profile already exists under "${c}".` });
        }
    }

    const trimmedCountry = country.trim();
    if (!profiles[trimmedCountry]) profiles[trimmedCountry] = [];

    const fullUrl = /^https?:\/\//.test(url) ? url : `https://www.credly.com/users/${url}`;
    profiles[trimmedCountry].push(fullUrl);
    writeProfiles(profiles);

    res.json(profiles);
});

// Remove a profile
app.delete('/api/profiles', (req, res) => {
    const { password, country, url } = req.body;

    if (password !== PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password.' });
    }
    if (!country || !url) {
        return res.status(400).json({ error: 'Country and URL are required.' });
    }

    const profiles = readProfiles();
    if (!profiles[country]) {
        return res.status(404).json({ error: 'Country not found.' });
    }

    const norm = normalizeUrl(url);
    profiles[country] = profiles[country].filter(u => normalizeUrl(u) !== norm);
    if (profiles[country].length === 0) delete profiles[country];

    writeProfiles(profiles);
    res.json(profiles);
});

// --- Start ---

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) writeProfiles({});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
