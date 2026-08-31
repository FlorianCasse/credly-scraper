const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Configure the environment BEFORE requiring server.js: required secrets and an
// isolated data file so tests never touch data/custom-profiles.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credly-test-'));
process.env.APP_PASSWORD = 'admin-test-password';
process.env.SITE_PASSWORD = 'site-test-password';
process.env.DATA_FILE = path.join(tmpDir, 'custom-profiles.json');

const {
    app,
    safeEqual,
    normalizeUrl,
    readProfiles,
    writeProfiles,
    createConcurrencyLimiter,
    getCached,
    setCache,
    getAllPredefinedUsernames,
} = require('../server');

// --- Unit tests: pure helpers ---

test('normalizeUrl extracts the lowercased username from any Credly URL shape', () => {
    assert.strictEqual(normalizeUrl('https://www.credly.com/users/Florian-Casse'), 'florian-casse');
    assert.strictEqual(normalizeUrl('http://credly.com/users/foo/badges'), 'foo');
    assert.strictEqual(normalizeUrl('https://www.credly.com/users/foo?x=1'), 'foo');
    assert.strictEqual(normalizeUrl('https://www.credly.com/users/foo#frag'), 'foo');
    assert.strictEqual(normalizeUrl('  just-a-username  '), 'just-a-username');
});

test('safeEqual compares constant-time and handles length mismatches', () => {
    assert.strictEqual(safeEqual('secret', 'secret'), true);
    assert.strictEqual(safeEqual('secret', 'Secret'), false);
    assert.strictEqual(safeEqual('secret', 'secret-longer'), false);
    assert.strictEqual(safeEqual('', ''), true);
});

test('writeProfiles/readProfiles round-trip through the data file', () => {
    writeProfiles({ France: ['https://www.credly.com/users/foo'] });
    assert.deepStrictEqual(readProfiles(), { France: ['https://www.credly.com/users/foo'] });
    writeProfiles({});
    assert.deepStrictEqual(readProfiles(), {});
});

test('cache stores and returns entries by key', () => {
    setCache('test-key', Buffer.from('{"a":1}'), 'application/json');
    const entry = getCached('test-key');
    assert.ok(entry);
    assert.strictEqual(entry.buffer.toString(), '{"a":1}');
    assert.strictEqual(entry.contentType, 'application/json');
    assert.strictEqual(getCached('missing-key'), null);
});

test('concurrency limiter never exceeds its max and propagates results/errors', async () => {
    const limit = createConcurrencyLimiter(2);
    let running = 0;
    let peak = 0;
    const job = (result, fail) => limit(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 10));
        running--;
        if (fail) throw new Error('boom');
        return result;
    });

    const results = await Promise.allSettled([
        job(1), job(2), job(3, true), job(4), job(5),
    ]);
    assert.strictEqual(peak, 2);
    assert.deepStrictEqual(results.map(r => r.status),
        ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    assert.strictEqual(results[3].value, 4);
});

test('getAllPredefinedUsernames merges predefined and custom profiles without duplicates', () => {
    writeProfiles({ Spain: ['https://www.credly.com/users/some-custom-user', 'https://www.credly.com/users/florian-casse'] });
    const usernames = getAllPredefinedUsernames();
    assert.ok(usernames.includes('florian-casse'));      // predefined (France)
    assert.ok(usernames.includes('malte-wilhelm'));      // predefined (Germany)
    assert.ok(usernames.includes('paul-john-mcconnon')); // predefined (Nordics)
    assert.ok(usernames.includes('some-custom-user'));   // custom
    assert.strictEqual(usernames.filter(u => u === 'florian-casse').length, 1); // deduped
    writeProfiles({});
});

// --- HTTP tests against the real Express app ---

let server;
let base;
const SITE_AUTH = 'Basic ' + Buffer.from('credly:site-test-password').toString('base64');

function req(pathname, { method = 'GET', auth = SITE_AUTH, body } = {}) {
    const headers = {};
    if (auth) headers['Authorization'] = auth;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(base + pathname, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

before(async () => {
    writeProfiles({});
    await new Promise(resolve => {
        server = app.listen(0, () => {
            base = `http://localhost:${server.address().port}`;
            resolve();
        });
    });
});

after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('every route requires Basic Auth', async () => {
    assert.strictEqual((await req('/', { auth: null })).status, 401);
    assert.strictEqual((await req('/api/profiles', { auth: null })).status, 401);
    const wrong = 'Basic ' + Buffer.from('credly:wrong').toString('base64');
    assert.strictEqual((await req('/', { auth: wrong })).status, 401);
});

test('GET / serves the app with valid auth', async () => {
    const res = await req('/');
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /Credly Badge Scraper/);
});

test('GET / includes the accessible issuer filter and loads its utility before script.js', async () => {
    const res = await req('/');
    const html = await res.text();

    assert.match(html, /<label for="filter-issuer">Filter by issuer/);
    assert.match(html, /<select[^>]+id="filter-issuer"[^>]+multiple[^>]+disabled/);
    assert.match(html, /id="filter-issuer-hint"[^>]*>[^<]*(Cmd|Ctrl)[^<]*multi-select/);
    const utilityIndex = html.indexOf('src="badge-utils.js"');
    const scriptIndex = html.indexOf('src="script.js"');
    assert.ok(utilityIndex >= 0);
    assert.ok(scriptIndex > utilityIndex);
});

test('only allowlisted frontend assets are served as static files', async () => {
    for (const ok of ['/index.html', '/style.css', '/script.js', '/predefined-profiles.js', '/badge-utils.js']) {
        assert.strictEqual((await req(ok)).status, 200, ok);
    }
    for (const blocked of ['/server.js', '/package.json', '/package-lock.json', '/README.md', '/data/custom-profiles.json']) {
        assert.strictEqual((await req(blocked)).status, 404, blocked);
    }
});

test('GET /api/credly validates its url parameter', async () => {
    assert.strictEqual((await req('/api/credly')).status, 400);
    assert.strictEqual((await req('/api/credly?url=not-a-url')).status, 400);
    assert.strictEqual((await req('/api/credly?url=' + encodeURIComponent('https://evil.example.com/x'))).status, 403);
});

test('POST /api/batch-badges validates its payload', async () => {
    assert.strictEqual((await req('/api/batch-badges', { method: 'POST', body: {} })).status, 400);
    assert.strictEqual((await req('/api/batch-badges', { method: 'POST', body: { usernames: [] } })).status, 400);
    const tooMany = { usernames: Array.from({ length: 101 }, (_, i) => `u${i}`) };
    assert.strictEqual((await req('/api/batch-badges', { method: 'POST', body: tooMany })).status, 400);
});

test('profile CRUD: add, reject duplicates and bad input, remove', async () => {
    const url = 'https://www.credly.com/users/test-user-xyz';

    // wrong admin password
    let res = await req('/api/profiles', { method: 'POST', body: { password: 'nope', country: 'Spain', url } });
    assert.strictEqual(res.status, 401);

    // missing country / invalid URL
    res = await req('/api/profiles', { method: 'POST', body: { password: 'admin-test-password', country: '  ', url } });
    assert.strictEqual(res.status, 400);
    res = await req('/api/profiles', { method: 'POST', body: { password: 'admin-test-password', country: 'Spain', url: 'https://example.com/foo' } });
    assert.strictEqual(res.status, 400);

    // valid add
    res = await req('/api/profiles', { method: 'POST', body: { password: 'admin-test-password', country: 'Spain', url } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { Spain: [url] });

    // duplicate (different shape, same username)
    res = await req('/api/profiles', { method: 'POST', body: { password: 'admin-test-password', country: 'Italy', url: 'credly.com/users/TEST-USER-XYZ' } });
    assert.strictEqual(res.status, 409);

    // listed
    res = await req('/api/profiles');
    assert.deepStrictEqual(await res.json(), { Spain: [url] });

    // remove requires the admin password
    res = await req('/api/profiles', { method: 'DELETE', body: { password: 'nope', country: 'Spain', url } });
    assert.strictEqual(res.status, 401);
    res = await req('/api/profiles', { method: 'DELETE', body: { password: 'admin-test-password', country: 'Spain', url } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), {});
});
