// Browser-side tests for the chunked batch fetch in script.js.
//
// script.js runs in the page, so these load index.html into jsdom and evaluate
// the real frontend sources against it. Only the two network primitives the
// chunk logic depends on -- EventSource and fetch -- are stubbed, so the code
// under test is the shipped code, not a re-implementation.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// --- Fake EventSource -------------------------------------------------------
// Records every instance so a test can assert which URLs were opened, and
// replays a scripted sequence of events on the next tick so `await` works.

function makeFakeEventSource(scriptFor) {
    const instances = [];

    class FakeEventSource {
        constructor(url) {
            this.url = url;
            this.closed = false;
            this.listeners = {};
            this.onmessage = null;
            this.onerror = null;
            instances.push(this);

            // Emit on a later tick: the caller wires up handlers synchronously
            // right after construction, exactly like a real EventSource.
            setTimeout(() => this.#replay(scriptFor(url)), 0);
        }

        addEventListener(type, fn) {
            (this.listeners[type] ||= []).push(fn);
        }

        close() {
            this.closed = true;
        }

        async #replay(steps) {
            for (const step of steps) {
                // `after` spaces events out in real time so a test can prove the
                // idle watchdog is reset by activity rather than by total elapsed.
                if (step.after) await new Promise(r => setTimeout(r, step.after));
                if (this.closed) return;
                if (step.type === 'message') {
                    this.onmessage?.({ data: step.data });
                } else if (step.type === 'done') {
                    (this.listeners.done || []).forEach(fn => fn({ data: '{}' }));
                } else if (step.type === 'error') {
                    this.onerror?.({});
                }
            }
        }
    }

    return { FakeEventSource, instances };
}

// A profile payload as the server streams it. Empty badge lists keep rendering
// off the canvas path -- these tests are about transport, not image drawing.
const profileEvent = (username, extra = {}) =>
    ({ type: 'message', data: JSON.stringify({ username, displayName: username, badges: [], ...extra }) });

const DONE = { type: 'done' };
const ERROR = { type: 'error' };

// --- App loader -------------------------------------------------------------

function loadApp({ eventSourceScript = () => [DONE], fetchImpl, idleTimeoutMs = null } = {}) {
    const dom = new JSDOM(read('index.html'), {
        url: 'http://localhost/',
        runScripts: 'dangerously',
    });
    const { window } = dom;

    const warnings = [];
    window.console.warn = (...args) => warnings.push(args.join(' '));

    const fetchCalls = [];
    window.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        // script.js loads custom profiles on startup; keep that path inert.
        if (String(url).startsWith('/api/profiles')) {
            return { ok: true, status: 200, json: async () => ({}) };
        }
        if (!fetchImpl) throw new Error(`unexpected fetch: ${url}`);
        return fetchImpl(url, options);
    };

    const { FakeEventSource, instances } = makeFakeEventSource(eventSourceScript);
    window.EventSource = FakeEventSource;

    if (idleTimeoutMs !== null) {
        // The SSE idle watchdog is the only multi-second timer in script.js.
        // Rewrite just that delay so the stall paths run in milliseconds while
        // keeping the timer's reset-on-activity semantics intact.
        const realSetTimeout = window.setTimeout;
        window.setTimeout = (fn, delay, ...rest) =>
            realSetTimeout(fn, delay >= 1000 ? idleTimeoutMs : delay, ...rest);
    }

    // Same order as index.html: helpers first, then the app.
    window.eval(read('predefined-profiles.js'));
    window.eval(read('badge-utils.js'));
    window.eval(read('script.js'));

    return { window, warnings, fetchCalls, eventSources: instances };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// --- fetchChunkViaStream ----------------------------------------------------

test('fetchChunkViaStream delivers each streamed profile and resolves on done', async () => {
    const { window, eventSources } = loadApp({
        eventSourceScript: () => [profileEvent('alice'), profileEvent('bob'), DONE],
    });

    const seen = [];
    await window.fetchChunkViaStream(['alice', 'bob'], r => seen.push(r.username));

    assert.deepStrictEqual(seen, ['alice', 'bob']);
    assert.strictEqual(eventSources.length, 1);
    assert.ok(eventSources[0].closed, 'stream should be closed once done arrives');
    assert.match(eventSources[0].url, /^\/api\/batch-badges-stream\?usernames=alice%2Cbob$/);
});

test('fetchChunkViaStream skips a malformed event and keeps the rest of the stream', async () => {
    const { window, warnings } = loadApp({
        eventSourceScript: () => [
            profileEvent('alice'),
            { type: 'message', data: '{not json' },
            profileEvent('bob'),
            DONE,
        ],
    });

    const seen = [];
    await window.fetchChunkViaStream(['alice', 'bob'], r => seen.push(r.username));

    // The bad frame is dropped, not fatal, and the good frames still land.
    assert.deepStrictEqual(seen, ['alice', 'bob']);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Skipping malformed SSE event/);
});

test('fetchChunkViaStream rejects when the stream dies before delivering anything', async () => {
    const { window, eventSources } = loadApp({ eventSourceScript: () => [ERROR] });

    await assert.rejects(
        () => window.fetchChunkViaStream(['alice'], () => {
            throw new Error('onResult must not be called');
        }),
        /SSE stream failed/
    );
    assert.ok(eventSources[0].closed, 'a failed stream must still be closed');
});

test('fetchChunkViaStream treats a mid-stream failure as partial success', async () => {
    // Anything already delivered is kept: resolving here is what stops the
    // caller from re-fetching the whole chunk over POST and duplicating work.
    const { window } = loadApp({
        eventSourceScript: () => [profileEvent('alice'), ERROR],
    });

    const seen = [];
    await window.fetchChunkViaStream(['alice', 'bob'], r => seen.push(r.username));

    assert.deepStrictEqual(seen, ['alice']);
});

// --- fetchChunkViaPost ------------------------------------------------------

test('fetchChunkViaPost forwards every profile in the response body', async () => {
    const { window, fetchCalls } = loadApp({
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ([
                { username: 'alice', displayName: 'Alice', badges: [] },
                { username: 'bob', displayName: 'Bob', badges: [] },
            ]),
        }),
    });

    const seen = [];
    await window.fetchChunkViaPost(['alice', 'bob'], r => seen.push(r.username));

    assert.deepStrictEqual(seen, ['alice', 'bob']);
    const post = fetchCalls.find(c => c.url === '/api/batch-badges');
    assert.strictEqual(post.options.method, 'POST');
    assert.deepStrictEqual(JSON.parse(post.options.body), { usernames: ['alice', 'bob'] });
});

test('fetchChunkViaPost surfaces the server error message verbatim', async () => {
    // This is the whole point of the change: the user must see "Maximum 250
    // usernames per batch", not a generic "Batch fetch failed".
    const { window } = loadApp({
        fetchImpl: async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'Maximum 250 usernames per batch' }),
        }),
    });

    await assert.rejects(
        () => window.fetchChunkViaPost(['alice'], () => {}),
        /Maximum 250 usernames per batch/
    );
});

test('fetchChunkViaPost falls back to the status code when the body is not JSON', async () => {
    const { window } = loadApp({
        fetchImpl: async () => ({
            ok: false,
            status: 503,
            json: async () => { throw new SyntaxError('Unexpected token'); },
        }),
    });

    await assert.rejects(
        () => window.fetchChunkViaPost(['alice'], () => {}),
        /Batch fetch failed \(HTTP 503\)/
    );
});

// --- The chunk loop in handleFetchBadges ------------------------------------

const usernamesForChunks = (count) =>
    Array.from({ length: count }, (_, i) => `user-${String(i).padStart(3, '0')}`);

const urlsFor = (usernames) =>
    usernames.map(u => `https://www.credly.com/users/${u}`).join('\n');

// Which chunk a stream URL belongs to, by looking for a username only that
// chunk contains.
const urlHas = (url, username) => decodeURIComponent(url).includes(username);

test('a chunk whose stream fails falls back to POST without disturbing the others', async () => {
    const usernames = usernamesForChunks(60); // 50 + 10 across two chunks
    const secondChunk = usernames.slice(50);

    const { window, fetchCalls, eventSources } = loadApp({
        eventSourceScript: (url) => {
            // Kill the second chunk's stream before it delivers anything.
            if (urlHas(url, 'user-050')) return [ERROR];
            return [...usernames.slice(0, 50).map(u => profileEvent(u)), DONE];
        },
        fetchImpl: async (url, options) => {
            assert.strictEqual(url, '/api/batch-badges');
            const body = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                json: async () => body.usernames.map(u => ({ username: u, displayName: u, badges: [] })),
            };
        },
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);
    await window.handleFetchBadges();
    await flush();

    // Two streams attempted, one POST fallback, and it carried only the failed chunk.
    assert.strictEqual(eventSources.length, 2);
    const posts = fetchCalls.filter(c => c.url === '/api/batch-badges');
    assert.strictEqual(posts.length, 1, 'only the failed chunk should be retried');
    assert.deepStrictEqual(JSON.parse(posts[0].options.body).usernames, secondChunk);

    // Every profile still rendered, and no error banner.
    const headers = window.document.querySelectorAll('#badges-grid .profile-header');
    assert.strictEqual(headers.length, 60);
    assert.strictEqual(window.document.querySelectorAll('.profile-header--error').length, 0);
    assert.strictEqual(window.document.getElementById('error-message').style.display, 'none');
});

test('when both endpoints fail for a chunk, that chunk is marked and the rest survive', async () => {
    const usernames = usernamesForChunks(60);
    const secondChunk = usernames.slice(50);

    const { window } = loadApp({
        eventSourceScript: (url) => {
            if (urlHas(url, 'user-050')) return [ERROR];
            return [...usernames.slice(0, 50).map(u => profileEvent(u)), DONE];
        },
        fetchImpl: async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: 'upstream exploded' }),
        }),
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);
    await window.handleFetchBadges();
    await flush();

    // The 10 usernames in the dead chunk each get their own error header...
    const errorHeaders = [...window.document.querySelectorAll('.profile-header--error')]
        .map(el => el.textContent);
    assert.strictEqual(errorHeaders.length, secondChunk.length);
    for (const username of secondChunk) {
        assert.ok(
            errorHeaders.some(text => text.startsWith(`${username} — Failed: upstream exploded`)),
            `expected an error header for ${username}`
        );
    }

    // ...the banner reports how many were lost and why...
    const banner = window.document.getElementById('error-message');
    assert.notStrictEqual(banner.style.display, 'none');
    assert.match(banner.textContent, /10 profile\(s\) could not be fetched: upstream exploded/);

    // ...and the first chunk still rendered normally.
    const okHeaders = [...window.document.querySelectorAll('#badges-grid .profile-header')]
        .filter(el => !el.classList.contains('profile-header--error'));
    assert.strictEqual(okHeaders.length, 50);
});

test('a whole-company selection is split into chunks that respect the server cap', async () => {
    const usernames = usernamesForChunks(182);

    const { window, eventSources } = loadApp({
        eventSourceScript: (url) => {
            const mine = usernames.filter(u => urlHas(url, u));
            return [...mine.map(u => profileEvent(u)), DONE];
        },
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);
    await window.handleFetchBadges();
    await flush();

    // 182 profiles -> 50/50/50/32, in order, each within the cap.
    assert.strictEqual(eventSources.length, 4);
    const sent = eventSources.map(es =>
        decodeURIComponent(new URL(es.url, 'http://localhost').searchParams.get('usernames')).split(','));
    assert.deepStrictEqual(sent.map(c => c.length), [50, 50, 50, 32]);
    assert.deepStrictEqual(sent.flat(), usernames, 'every profile is requested exactly once, in order');

    // Display order follows the input list, not the arrival order.
    const rendered = [...window.document.querySelectorAll('#badges-grid .profile-header')]
        .map(el => el.textContent.split(' ')[0]);
    assert.deepStrictEqual(rendered, usernames);
});

// --- Issuer filter provenance across a failed fetch ------------------------
// Regression guard for a known trap: setLoading(false) re-enables the issuer
// select whenever it still holds options (script.js:274), and the chunk loop
// now rebuilds the filter even when every chunk failed. A wiped-out fetch must
// therefore leave the filter empty, not resurrect the previous batch's issuers.

// A badge with no image_url renders without touching the canvas path.
const badgeFrom = (issuer) => ({
    id: `badge-${issuer}`,
    badge_template: { name: `${issuer} Certified` },
    issuer: { entities: [{ primary: true, entity: { name: issuer } }] },
    issued_at: '2026-01-01T00:00:00Z',
});

test('a fetch that fails completely does not leave the previous batch issuers selectable', async () => {
    let failEverything = false;

    const { window } = loadApp({
        eventSourceScript: (url) => {
            if (failEverything) return [ERROR];
            return [
                { type: 'message', data: JSON.stringify({
                    username: 'alice', displayName: 'Alice', badges: [badgeFrom('Broadcom'), badgeFrom('Cisco')],
                }) },
                DONE,
            ];
        },
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: 'upstream down' }) }),
    });

    const issuerSelect = window.document.getElementById('filter-issuer');

    // First batch succeeds and populates the issuer filter.
    window.document.getElementById('profile-url').value = 'https://www.credly.com/users/alice';
    await window.handleFetchBadges();
    await flush();
    assert.deepStrictEqual([...issuerSelect.options].map(o => o.value), ['Broadcom', 'Cisco']);
    assert.strictEqual(issuerSelect.disabled, false);

    // User selects one, then switches to a different profile whose fetch dies.
    issuerSelect.options[0].selected = true;
    failEverything = true;
    window.document.getElementById('profile-url').value = 'https://www.credly.com/users/bob';
    await window.handleFetchBadges();
    await flush();

    // No badges came back, so no issuer may remain offered or selectable.
    assert.deepStrictEqual([...issuerSelect.options].map(o => o.value), [],
        'stale issuers from the previous batch must not survive a failed fetch');
    assert.strictEqual(issuerSelect.disabled, true,
        'an empty issuer filter must stay disabled after setLoading(false)');
    assert.strictEqual(window.document.getElementById('badge-count').textContent, '(0)');
});

// --- Review findings: regression guards ------------------------------------

test('a stream that dies mid-chunk reports the profiles it never delivered', async () => {
    // Partial success resolves rather than falling back, so without an explicit
    // reconciliation the undelivered profiles would sit as silent empty slots.
    const usernames = usernamesForChunks(10);

    const { window } = loadApp({
        eventSourceScript: () => [...usernames.slice(0, 4).map(u => profileEvent(u)), ERROR],
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);
    await window.handleFetchBadges();
    await flush();

    const errorHeaders = [...window.document.querySelectorAll('.profile-header--error')]
        .map(el => el.textContent);
    assert.strictEqual(errorHeaders.length, 6, 'the 6 undelivered profiles must be marked');
    for (const username of usernames.slice(4)) {
        assert.ok(errorHeaders.some(t => t.startsWith(`${username} — Failed:`)), `missing ${username}`);
    }

    const banner = window.document.getElementById('error-message');
    assert.match(banner.textContent, /6 profile\(s\) could not be fetched/);
});

test('Ctrl+Enter cannot start a second fetch while one is in flight', async () => {
    const usernames = usernamesForChunks(60); // two chunks, so the fetch stays open
    const { window, eventSources } = loadApp({
        eventSourceScript: (url) => {
            const mine = usernames.filter(u => urlHas(url, u));
            return [...mine.map(u => profileEvent(u)), DONE];
        },
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);

    const inFlight = window.handleFetchBadges();
    // Hammer the shortcut while the first fetch is still running.
    for (let i = 0; i < 3; i++) {
        window.document.getElementById('profile-url').dispatchEvent(
            new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
        );
    }
    await inFlight;
    await flush();

    // Exactly two streams: a concurrent run would wipe badgesGrid mid-render and
    // open more.
    assert.strictEqual(eventSources.length, 2);
    assert.strictEqual(window.document.querySelectorAll('#badges-grid .profile-header').length, 60);
});

test('each failed chunk is reported with its own error, not the first one', async () => {
    // Two chunks fail for different reasons. Attributing chunk 1's message to
    // chunk 3's profiles would send the user debugging the wrong thing.
    const usernames = usernamesForChunks(150); // three chunks of 50

    const { window } = loadApp({
        eventSourceScript: (url) => {
            if (urlHas(url, 'user-000') ) {
                return [...usernames.slice(0, 50).map(u => profileEvent(u)), DONE];
            }
            return [ERROR]; // chunks 2 and 3 lose their stream
        },
        fetchImpl: async (url, options) => {
            const { usernames: sent } = JSON.parse(options.body);
            const reason = sent.includes('user-050') ? 'rate limited' : 'gateway timeout';
            return { ok: false, status: 500, json: async () => ({ error: reason }) };
        },
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);
    await window.handleFetchBadges();
    await flush();

    const headerFor = (username) =>
        [...window.document.querySelectorAll('.profile-header--error')]
            .map(el => el.textContent)
            .find(t => t.startsWith(`${username} — `));

    assert.match(headerFor('user-050'), /rate limited/);
    assert.match(headerFor('user-100'), /gateway timeout/);
    assert.ok(!headerFor('user-000'), 'the healthy chunk must not be marked failed');

    // The banner names both causes rather than silently picking one.
    const banner = window.document.getElementById('error-message').textContent;
    assert.match(banner, /100 profile\(s\) could not be fetched/);
    assert.match(banner, /rate limited/);
    assert.match(banner, /gateway timeout/);
});

test('the same profile listed twice is fetched and rendered once', async () => {
    // Duplicates reach the box by pasting, or by one person sitting in two
    // country groups. Rendering twice pushes their badges into `badges` twice,
    // which silently inflates the count, the CSV and the shared-cert tallies.
    const { window, eventSources } = loadApp({
        eventSourceScript: () => [
            { type: 'message', data: JSON.stringify({
                username: 'alice', displayName: 'Alice', badges: [badgeFrom('Broadcom')],
            }) },
            { type: 'message', data: JSON.stringify({
                username: 'bob', displayName: 'Bob', badges: [badgeFrom('Cisco')],
            }) },
            DONE,
        ],
    });

    window.document.getElementById('profile-url').value = [
        'https://www.credly.com/users/alice',
        'https://www.credly.com/users/bob',
        'https://www.credly.com/users/alice',   // exact repeat
        'https://www.credly.com/users/ALICE',   // Credly usernames are case-insensitive
    ].join('\n');
    await window.handleFetchBadges();
    await flush();

    const requested = decodeURIComponent(
        new URL(eventSources[0].url, 'http://localhost').searchParams.get('usernames')).split(',');
    assert.deepStrictEqual(requested, ['alice', 'bob'], 'the duplicate must not be requested again');

    // No orphaned empty container, and no double-counted badges.
    assert.strictEqual(window.document.querySelectorAll('#badges-grid > div').length, 2);
    assert.strictEqual(window.document.querySelectorAll('#badges-grid .profile-header').length, 2);
    assert.strictEqual(window.document.getElementById('badge-count').textContent, '(2)');
});

test('a stream that stalls without closing is abandoned instead of hanging the batch', async () => {
    // The dangerous shape is silence with no error and no close: without the
    // idle watchdog the loop awaits forever and setLoading(false) never runs,
    // leaving the button disabled until the user reloads the page.
    const { window, fetchCalls } = loadApp({
        idleTimeoutMs: 0,
        eventSourceScript: () => [],  // connects, then says nothing at all
        fetchImpl: async (url, options) => {
            const body = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                json: async () => body.usernames.map(u => ({ username: u, displayName: u, badges: [] })),
            };
        },
    });

    window.document.getElementById('profile-url').value = urlsFor(['alice', 'bob']);
    await window.handleFetchBadges();
    await flush();

    // It fell through to POST rather than hanging, and the UI is usable again.
    const posts = fetchCalls.filter(c => c.url === '/api/batch-badges');
    assert.strictEqual(posts.length, 1, 'a stalled stream must fall back to POST');
    assert.strictEqual(window.document.querySelectorAll('#badges-grid .profile-header').length, 2);
    assert.strictEqual(window.document.getElementById('fetch-btn').disabled, false,
        'setLoading(false) must run -- a hung fetch leaves the button dead');
});

test('a stall after partial delivery keeps what arrived instead of refetching', async () => {
    const { window, fetchCalls } = loadApp({
        idleTimeoutMs: 0,
        eventSourceScript: () => [profileEvent('alice')],  // one profile, then silence
    });

    window.document.getElementById('profile-url').value = urlsFor(['alice', 'bob']);
    await window.handleFetchBadges();
    await flush();

    assert.strictEqual(fetchCalls.filter(c => c.url === '/api/batch-badges').length, 0,
        'partial delivery must not trigger a duplicate POST for the whole chunk');
    // alice rendered; bob is reported missing rather than silently absent.
    const errors = [...window.document.querySelectorAll('.profile-header--error')].map(e => e.textContent);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /^bob — Failed:/);
    assert.strictEqual(window.document.getElementById('fetch-btn').disabled, false);
});

test('a slow but steady stream is not killed by the idle watchdog', async () => {
    // The watchdog must measure SILENCE, not total elapsed time. A 50-profile
    // chunk legitimately runs for tens of seconds; if the timer were armed once
    // and never reset, healthy long chunks would be aborted and re-fetched.
    const usernames = ['alice', 'bob', 'carol', 'dave', 'erin'];

    const { window, fetchCalls } = loadApp({
        idleTimeoutMs: 60,
        // Each profile lands well inside the window, but the whole stream runs
        // far longer than one window.
        eventSourceScript: () => [
            ...usernames.map(u => ({ ...profileEvent(u), after: 25 })),
            { type: 'done', after: 25 },
        ],
    });

    window.document.getElementById('profile-url').value = urlsFor(usernames);
    await window.handleFetchBadges();
    await flush();

    assert.strictEqual(fetchCalls.filter(c => c.url === '/api/batch-badges').length, 0,
        'a healthy stream must never fall back to POST');
    assert.strictEqual(window.document.querySelectorAll('#badges-grid .profile-header').length, 5);
    assert.strictEqual(window.document.querySelectorAll('.profile-header--error').length, 0);
});
