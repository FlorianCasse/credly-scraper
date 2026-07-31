const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const PREDEFINED_PROFILES = require('./predefined-profiles');

// Load secrets from a local .env file if present. .env is gitignored and never
// committed, so no password ever lives in the (public) source code.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env — rely on the real environment */ }

const app = express();
const PORT = process.env.PORT || 3002;
const PASSWORD = process.env.APP_PASSWORD;
const SITE_USER = process.env.SITE_USER || 'credly';
const SITE_PASSWORD = process.env.SITE_PASSWORD;
// DATA_FILE is overridable via env so tests can use an isolated file.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'custom-profiles.json');

// Fail fast if a required secret is missing — there are no insecure hardcoded
// defaults to fall back on.
for (const [name, value] of [['APP_PASSWORD', PASSWORD], ['SITE_PASSWORD', SITE_PASSWORD]]) {
    if (!value) {
        console.error(`Missing required env var ${name}. Set it in a .env file or the environment (see .env.example).`);
        process.exit(1);
    }
}

app.use(express.json());

// --- Site-wide access gate (HTTP Basic Auth) ---
// Protects every route (pages, assets, and /api/*) behind a single password.
// Separate from APP_PASSWORD, which additionally gates profile add/remove.

function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString();
        const i = decoded.indexOf(':');
        const user = decoded.slice(0, i);
        const pass = decoded.slice(i + 1);
        if (safeEqual(user, SITE_USER) && safeEqual(pass, SITE_PASSWORD)) {
            return next();
        }
    }
    res.set('WWW-Authenticate', 'Basic realm="Credly Scraper", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
});

// Serve only the frontend assets — never server code, data files or repo metadata.
const STATIC_FILES = ['index.html', 'style.css', 'script.js', 'predefined-profiles.js'];
for (const file of STATIC_FILES) {
    app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
}

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
    // Write-then-rename so a crash mid-write can never corrupt the data file.
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
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
    if (parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
    }
    if (parsed.username || parsed.password) {
        return res.status(400).json({ error: 'URLs with credentials are not allowed' });
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

// --- Concurrency Limiter ---

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

// --- Batch Badges Endpoint ---
// Fetches profile info + all badges for multiple usernames in one request

function fetchUrl(url) {
    const cacheKey = url;
    const cached = getCached(cacheKey);
    if (cached) return Promise.resolve(JSON.parse(cached.buffer.toString()));

    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; CredlyScraper/1.0)',
            }
        }, (upstream) => {
            if (upstream.statusCode !== 200) {
                upstream.resume();
                return reject(new Error(`HTTP ${upstream.statusCode}`));
            }
            const chunks = [];
            upstream.on('data', chunk => chunks.push(chunk));
            upstream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = upstream.headers['content-type'] || 'application/json';
                setCache(cacheKey, buffer, contentType);
                try { resolve(JSON.parse(buffer.toString())); }
                catch { reject(new Error('Invalid JSON')); }
            });
        }).on('error', reject);
    });
}

async function fetchAllBadges(username) {
    const allBadges = [];
    let nextUrl = `https://www.credly.com/users/${username}/badges.json`;
    while (nextUrl) {
        const data = await fetchUrl(nextUrl);
        if (!data.data) break;
        allBadges.push(...data.data);
        nextUrl = data.metadata?.next_page_url || null;
    }
    return allBadges;
}

async function fetchDisplayName(username) {
    try {
        const data = await fetchUrl(`https://www.credly.com/users/${username}.json`);
        const user = data.data;
        if (user) {
            const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
            return fullName || username;
        }
    } catch { /* fall through */ }
    return username;
}

app.post('/api/batch-badges', async (req, res) => {
    const { usernames } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({ error: 'usernames array is required' });
    }
    if (usernames.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 usernames per batch' });
    }

    const limit = createConcurrencyLimiter(10);
    const results = await Promise.allSettled(
        usernames.map((username) => limit(async () => {
            const [displayName, badges] = await Promise.all([
                fetchDisplayName(username),
                fetchAllBadges(username),
            ]);
            return { username, displayName, badges };
        }))
    );

    const response = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return { username: usernames[i], displayName: usernames[i], badges: [], error: r.reason?.message };
    });

    res.json(response);
});

// --- SSE Streaming Batch Endpoint ---

app.get('/api/batch-badges-stream', (req, res) => {
    const raw = req.query.usernames;
    if (!raw) return res.status(400).json({ error: 'usernames query parameter is required' });

    const usernames = raw.split(',').map(u => u.trim()).filter(Boolean);
    if (usernames.length === 0) return res.status(400).json({ error: 'No usernames provided' });
    if (usernames.length > 100) return res.status(400).json({ error: 'Maximum 100 usernames per batch' });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    let closed = false;
    req.on('close', () => { closed = true; });

    const limit = createConcurrencyLimiter(10);
    let completed = 0;

    usernames.forEach((username) => {
        limit(async () => {
            if (closed) return;
            try {
                const [displayName, badges] = await Promise.all([
                    fetchDisplayName(username),
                    fetchAllBadges(username),
                ]);
                if (!closed) {
                    res.write(`data: ${JSON.stringify({ username, displayName, badges })}\n\n`);
                }
            } catch (err) {
                if (!closed) {
                    res.write(`data: ${JSON.stringify({ username, displayName: username, badges: [], error: err.message })}\n\n`);
                }
            }
            completed++;
            if (completed === usernames.length && !closed) {
                res.write('event: done\ndata: {}\n\n');
                res.end();
            }
        });
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

    if (typeof password !== 'string' || !safeEqual(password, PASSWORD)) {
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

    if (typeof password !== 'string' || !safeEqual(password, PASSWORD)) {
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

// --- Cache Prewarm ---

function getAllPredefinedUsernames() {
    try {
        const custom = readProfiles();
        const allUrls = [];
        // Predefined (shared with the frontend via predefined-profiles.js) + custom profiles
        for (const urls of [...Object.values(PREDEFINED_PROFILES), ...Object.values(custom)]) {
            for (const url of urls) {
                const match = url.match(/\/users\/([^\/\s#?]+)/i);
                if (match) allUrls.push(match[1]);
            }
        }
        return [...new Set(allUrls)];
    } catch { return []; }
}

async function prewarmCache() {
    const usernames = getAllPredefinedUsernames();
    if (usernames.length === 0) return;
    console.log(`[prewarm] Warming cache for ${usernames.length} profiles...`);

    const limit = createConcurrencyLimiter(5);
    let done = 0;

    await Promise.allSettled(
        usernames.map((username) => limit(async () => {
            try {
                await Promise.all([
                    fetchDisplayName(username),
                    fetchAllBadges(username),
                ]);
            } catch (err) {
                console.warn(`[prewarm] Failed for ${username}: ${err.message}`);
            }
            done++;
            if (done % 10 === 0 || done === usernames.length) {
                console.log(`[prewarm] ${done}/${usernames.length} profiles cached`);
            }
        }))
    );

    console.log('[prewarm] Cache warming complete');
}

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        prewarmCache();
    });
}

// Exported for the test suite (tests/server.test.js)
module.exports = {
    app,
    safeEqual,
    normalizeUrl,
    readProfiles,
    writeProfiles,
    createConcurrencyLimiter,
    getCached,
    setCache,
    getAllPredefinedUsernames,
};
