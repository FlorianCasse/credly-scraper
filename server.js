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

// --- Credly Proxy ---
// Server-side proxy to Credly API — eliminates the need for third-party CORS proxies

app.get('/api/credly/*', (req, res) => {
    // Extract the Credly path after /api/credly/
    const credlyPath = req.params[0];
    const credlyUrl = `https://www.credly.com/${credlyPath}`;

    https.get(credlyUrl, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CredlyScraper/1.0)',
        }
    }, (upstream) => {
        res.status(upstream.statusCode);
        // Forward content-type
        if (upstream.headers['content-type']) {
            res.set('Content-Type', upstream.headers['content-type']);
        }
        upstream.pipe(res);
    }).on('error', (err) => {
        console.error('Credly proxy error:', err.message);
        res.status(502).json({ error: 'Failed to reach Credly' });
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
