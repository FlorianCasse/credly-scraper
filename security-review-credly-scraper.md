# Security Review: credly-scraper

## Summary
- Total findings: 8
- Critical: 1 | High: 3 | Medium: 3 | Low: 1
- PRs opened: 6
  - https://github.com/FlorianCasse/credly-scraper/pull/20 (CRITICAL hardcoded password)
  - https://github.com/FlorianCasse/credly-scraper/pull/21 (HIGH XSS via innerHTML)
  - https://github.com/FlorianCasse/credly-scraper/pull/22 (HIGH static dir exposes repo)
  - https://github.com/FlorianCasse/credly-scraper/pull/23 (HIGH timing-unsafe password compare)
  - https://github.com/FlorianCasse/credly-scraper/pull/24 (MEDIUM SRI on JSZip CDN)
  - https://github.com/FlorianCasse/credly-scraper/pull/25 (MEDIUM body size limit + error leak)
- Issues opened: 0
  - Issues are disabled on this repository (HTTP 410). The two non-PR-ready findings (helmet/rate-limit and HTTPS enforcement) are inlined below.

## Scope
- Stack: Node.js, Express 4.21, vanilla JS/HTML/CSS frontend, bash helper script
- Files reviewed: `server.js`, `script.js`, `index.html`, `style.css` (no JS), `credly_badge_downloader.sh`, `package.json`, `.gitignore`, `.github/workflows/`
- Date: 2026-05-13

## Findings

### [CRITICAL] Hardcoded password fallback in server.js
- **File:** `server.js` (line 8) -- `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
- **Description:** The fallback string `'certificationitq1!'` ships in the public source. Any deployment that has not overridden `APP_PASSWORD` exposes a working admin credential to anyone who reads the repo, granting `POST` and `DELETE /api/profiles`.
- **Remediation:** Remove the fallback; require `APP_PASSWORD` (>= 12 chars) at startup; `process.exit(1)` if missing.
- **PR-ready:** yes
- **Action taken:** PR #20 https://github.com/FlorianCasse/credly-scraper/pull/20

### [HIGH] Stored XSS via innerHTML in script.js
- **File:** `script.js` -- `createBadgeCard`, `createCommonCard`, `renderByCertification`, `initQuickSelect`, custom-profile tag rendering
- **Description:** Multiple `innerHTML` assignments interpolate Credly-API-controlled strings (badge name, issuer, holder name) and server-stored user input (country, custom profile labels) without escaping. A badge template name like `<img src=x onerror=alert(1)>` -- or a country name typed by one user and read back by another -- becomes script execution in the viewer's browser. `view-original-btn` also placed an arbitrary `image_url` into a `data-url` attribute, which is attribute-injectable.
- **Remediation:** Add `escapeHtml()` and apply it to every untrusted interpolation; capture `image_url` in a closure and `window.open(url, '_blank', 'noopener,noreferrer')`; harden `escapeCSV` against CSV/spreadsheet formula injection.
- **PR-ready:** yes
- **Action taken:** PR #21 https://github.com/FlorianCasse/credly-scraper/pull/21

### [HIGH] express.static(__dirname) exposes the entire repository
- **File:** `server.js` (line 12)
- **Description:** `app.use(express.static(__dirname, ...))` serves the repo root, so `server.js`, `package.json`, `data/custom-profiles.json` (the user list), `credly_badge_downloader.sh`, `README.md`, and `.gitignore` are all reachable over HTTP. Also `/api/credly` accepted `http:` and `file:` URLs against the host allowlist because there was no `protocol === 'https:'` check, and the upstream `/users/${username}` interpolation accepted any string for the username path segment.
- **Remediation:** Explicitly route `/index.html`, `/script.js`, `/style.css`; validate usernames against `/^[A-Za-z0-9._-]{1,64}$/`; require `parsed.protocol === 'https:'` in the proxy.
- **PR-ready:** yes
- **Action taken:** PR #22 https://github.com/FlorianCasse/credly-scraper/pull/22

### [HIGH] Timing-unsafe password comparison
- **File:** `server.js` (lines 270, 297 -- `password !== PASSWORD`)
- **Description:** JavaScript string `!==` is variable-time and short-circuits on the first byte difference, leaking prefix information when paired with high-volume requests. Combined with the lack of rate-limiting (see medium finding below) the leak is amplifiable.
- **Remediation:** Pre-hash the configured password with SHA-256; for each request, SHA-256 the candidate and compare digests with `crypto.timingSafeEqual`. The hash normalises length so `timingSafeEqual` does not throw on length mismatch.
- **PR-ready:** yes
- **Action taken:** PR #23 https://github.com/FlorianCasse/credly-scraper/pull/23

### [MEDIUM] Missing security headers and rate limiting on Express server
- **File:** `server.js` (whole file)
- **Description:** No `helmet` (no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) and no `express-rate-limit`. Consequences: the proxy can be MIME-sniffed, the app can be iframed for clickjacking, `POST` / `DELETE /api/profiles` is brute-forceable, and the unauthenticated proxy / batch / SSE endpoints can be used to drive heavy upstream traffic to Credly from any IP.
- **Remediation:** `npm install helmet express-rate-limit`; mount `helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'script-src': ["'self'", 'https://cdnjs.cloudflare.com'], 'img-src': ["'self'", 'data:', 'blob:', 'https://images.credly.com'], 'connect-src': ["'self'"] } } })`; add a strict limiter (e.g. 20 req / 15 min) on the password-gated endpoints and a looser one (e.g. 120 req / min) on the proxy / batch / SSE endpoints; `app.disable('x-powered-by')`; `app.set('trust proxy', 1)`.
- **PR-ready:** no -- requires a new dependency and CSP fine-tuning that should be reviewed by the maintainer first.
- **Action taken:** Issue creation failed (Issues disabled on repo, HTTP 410); inlined here as required by the report contract.

### [MEDIUM] Missing Subresource Integrity on JSZip CDN script
- **File:** `index.html` (line 117)
- **Description:** `https://cdnjs.cloudflare.com/.../jszip.min.js` is loaded without `integrity=`. A cdnjs compromise or a TLS MITM on the user's path lets an attacker inject script that runs in the page origin, reads every Credly response, and reads the password the user types into `prompt()`.
- **Remediation:** Add the official jszip 3.10.1 sha512 `integrity=`, `crossorigin="anonymous"`, `referrerpolicy="no-referrer"`. Also add `rel="noopener noreferrer"` to the GitHub `target="_blank"` link.
- **PR-ready:** yes
- **Action taken:** PR #24 https://github.com/FlorianCasse/credly-scraper/pull/24

### [MEDIUM] No JSON body size limit + verbose error leak in batch / SSE endpoints
- **File:** `server.js` (`app.use(express.json())`, `/api/batch-badges`, `/api/batch-badges-stream`)
- **Description:** `express.json()` is called with no `limit`, so a single client can submit an arbitrarily large body and exhaust memory. `/api/batch-badges` and `/api/batch-badges-stream` echo raw `err.message` to the client, leaking upstream HTTP status / internal stack frames. `POST /api/profiles` accepts a `country` of any length.
- **Remediation:** `express.json({ limit: '64kb' })`; log upstream errors server-side and return a generic `"Fetch failed"`; cap `country` at 100 characters.
- **PR-ready:** yes
- **Action taken:** PR #25 https://github.com/FlorianCasse/credly-scraper/pull/25

### [LOW] No HTTPS enforcement / admin password sent in plaintext body
- **File:** `server.js` (`POST` / `DELETE /api/profiles`)
- **Description:** The admin password is sent in the JSON body of every profile mutation. Behind plain HTTP it is exposed in transit. There is no HSTS, no `http`->`https` upgrade, no session cookie that would let the password travel only once.
- **Remediation:** Best: switch to an `HttpOnly` + `Secure` + `SameSite=Strict` session cookie set after a one-time login, plus a CSRF token on mutations. Acceptable: bind the listener to `127.0.0.1` and require a TLS-terminating reverse proxy. Minimal: trust `X-Forwarded-Proto` and 308-redirect `http` to `https` before reading the body.
- **PR-ready:** no -- deployment-architecture decision.
- **Action taken:** Issue creation failed (Issues disabled, HTTP 410); inlined here.

## Notes on items checked and not flagged

- **SSRF in `/api/credly`:** Already partially mitigated by host allowlist (`www.credly.com`, `credly.com`, `images.credly.com`). The only gap was that `http:` / `file:` could slip past the host check on parsed URLs whose `hostname` matched. Fixed in PR #22 by adding an explicit `parsed.protocol === 'https:'` check.
- **Path traversal in `credly_badge_downloader.sh`:** The script extracts `username` with `BASH_REMATCH[1]` from `credly\.com/users/([^/]+)`, then uses it in `mkdir`, `mv`, and as a path segment in upstream URLs. A username like `..` would match. PR #6 already proposes a strict regex for this; not re-opened.
- **Command injection in `credly_badge_downloader.sh`:** All variable expansions are double-quoted, no `eval`, no unquoted `$(...)`. Looks safe assuming the username regex is tightened.
- **Insecure deserialisation / `eval`:** None found. `JSON.parse` on upstream responses is the only deserialiser and is wrapped in try/catch.
- **Dependency CVEs:** `express@^4.21.0` is the only declared dependency, no known critical CVEs at the time of review; recommend committing `package-lock.json` and adopting `npm audit` in CI.

## Recommendation

PR #20 (CRITICAL) is the must-merge. PRs #21, #22, #23 close the remaining HIGHs. PRs #24 and #25 are quick MEDIUM wins. Then act on the two inlined items (helmet + rate-limiting, and HTTPS enforcement) at the maintainer's discretion.
