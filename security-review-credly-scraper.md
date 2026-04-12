# Security Review: credly-scraper

**Date:** 2026-04-12
**Reviewer:** Claude (automated security review)
**Repository:** floriancasse/credly-scraper
**Stack:** Node.js / Express, Vanilla JS frontend, Bash shell script, GitHub Pages

## Summary
- **Total findings:** 27
- **Critical:** 1 | **High:** 9 | **Medium:** 12 | **Low:** 5
- **PRs opened:** 4
  - [PR #7](https://github.com/FlorianCasse/credly-scraper/pull/7) — Remove hardcoded password and fix authentication
  - [PR #8](https://github.com/FlorianCasse/credly-scraper/pull/8) — Harden server configuration and add protections
  - [PR #9](https://github.com/FlorianCasse/credly-scraper/pull/9) — Fix XSS vulnerabilities and add frontend protections
  - [PR #10](https://github.com/FlorianCasse/credly-scraper/pull/10) — Fix GitHub Pages deployment and pin Actions
- **Issues opened:** 0 (Issues are disabled in this repository; uncovered findings noted below)

## Findings

### [CRITICAL] Hardcoded Default Password in Source Code
- **File:** `server.js` (line 8)
- **Description:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';` — any deployment without APP_PASSWORD uses this publicly-known password, giving write/delete access to the profile store.
- **Remediation:** Remove fallback; require APP_PASSWORD env var; exit on startup if absent.
- **PR-ready:** yes
- **Action taken:** PR #7 https://github.com/FlorianCasse/credly-scraper/pull/7

### [HIGH] Password Transmitted and Compared in Plaintext
- **File:** `server.js` (line 8)
- **Description:** Password sent as plaintext JSON, compared with `===`. No timing-safe comparison, no rate-limiting, no hashing.
- **Remediation:** Use crypto.timingSafeEqual; add rate-limiting; require HTTPS.
- **PR-ready:** yes
- **Action taken:** PR #7 https://github.com/FlorianCasse/credly-scraper/pull/7

### [HIGH] No Security Headers — Missing Helmet or Equivalent
- **File:** `server.js` (line 12)
- **Description:** No CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, or HSTS headers.
- **Remediation:** Add helmet middleware or manual security headers.
- **PR-ready:** yes
- **Action taken:** PR #8 https://github.com/FlorianCasse/credly-scraper/pull/8

### [HIGH] Entire Working Directory Served as Static Files
- **File:** `server.js` (line 12)
- **Description:** `express.static(__dirname)` exposes server.js (with secrets), package.json, data/, .env, and all other files.
- **Remediation:** Block sensitive file paths; ideally move frontend to a public/ subdirectory.
- **PR-ready:** yes
- **Action taken:** PR #8 https://github.com/FlorianCasse/credly-scraper/pull/8

### [HIGH] Stored XSS via Country Field — JSON Injection
- **File:** `server.js` (lines 229-256)
- **Description:** Country field stored verbatim and rendered into DOM via innerHTML. Malicious country value executes in every visitor's browser.
- **Remediation:** Enforce strict allowlist for country values; use textContent instead of innerHTML.
- **PR-ready:** yes
- **Action taken:** PR #9 https://github.com/FlorianCasse/credly-scraper/pull/9

### [HIGH] Stored XSS via Badge Name and Issuer in innerHTML
- **File:** `script.js` (lines 277-285)
- **Description:** Badge names and issuer names interpolated directly into innerHTML template literals in createBadgeCard() and createCommonCard().
- **Remediation:** Use escapeHtml() or build DOM nodes with textContent.
- **PR-ready:** yes
- **Action taken:** PR #9 https://github.com/FlorianCasse/credly-scraper/pull/9

### [HIGH] Stored XSS via Certification Name in renderByCertification()
- **File:** `script.js` (lines 320-328)
- **Description:** Certification names interpolated into table.innerHTML template string.
- **Remediation:** Use document.createElement/textContent instead of innerHTML.
- **PR-ready:** yes
- **Action taken:** PR #9 https://github.com/FlorianCasse/credly-scraper/pull/9

### [HIGH] Uncontrolled Memory Growth — Cache Has No Per-Entry Size Cap
- **File:** `server.js` (lines 85-115)
- **Description:** In-memory cache accepts responses of any size. Combined with unauthenticated proxy, this is a DoS vector.
- **Remediation:** Enforce per-entry size cap (5 MB); reject oversized responses.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [HIGH] Unauthenticated Open Proxy — SSRF Risk via /api/credly
- **File:** `server.js` (lines 190-208)
- **Description:** Server-side HTTP requests to any credly.com URL path. Unauthenticated and abusable.
- **Remediation:** Restrict proxy to specific path patterns; add rate-limiting; validate content types.
- **PR-ready:** yes
- **Action taken:** PR #8 https://github.com/FlorianCasse/credly-scraper/pull/8

### [HIGH] GitHub Pages Deploys Entire Repository Root
- **File:** `.github/workflows/deploy.yml` (lines 33-36)
- **Description:** Uploads `path: '.'` as Pages artifact, publicly exposing server.js (with password), shell script, and data/.
- **Remediation:** Deploy only frontend files (index.html, style.css, script.js).
- **PR-ready:** yes
- **Action taken:** PR #10 https://github.com/FlorianCasse/credly-scraper/pull/10

### [MEDIUM] No Rate Limiting on Any Endpoint
- **File:** `server.js` (lines 155-175)
- **Description:** Batch endpoints accept up to 100 usernames per request. Unauthenticated spam can exhaust resources.
- **Remediation:** Add express-rate-limit globally and with stricter limits on batch/proxy endpoints.
- **PR-ready:** yes
- **Action taken:** PR #8 https://github.com/FlorianCasse/credly-scraper/pull/8

### [MEDIUM] No Input Sanitization on URL Field
- **File:** `server.js` (lines 229-256)
- **Description:** URL stored verbatim after loose regex; could contain malicious query parameters.
- **Remediation:** Reconstruct canonical URL from extracted username.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [MEDIUM] Synchronous File I/O on Every API Request
- **File:** `server.js` (lines 265-283)
- **Description:** readFileSync/writeFileSync blocks the event loop, causing cascading timeouts under load.
- **Remediation:** Switch to fs.promises; add write mutex.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [MEDIUM] JSON Parse Without Error Boundary — Non-Atomic Writes
- **File:** `server.js` (line 267)
- **Description:** Non-atomic writeFileSync; crash mid-write corrupts JSON. Reads silently return {} causing invisible data loss.
- **Remediation:** Use atomic write pattern (tmp file + rename).
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [MEDIUM] Missing Authentication on GET /api/profiles
- **File:** `server.js` (lines 235-237)
- **Description:** Returns full list of profile URLs and countries without authentication, leaking user/country associations.
- **Remediation:** Consider requiring auth for read access; document privacy trade-off.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [MEDIUM] Username Values Not Validated Before URL Construction
- **File:** `server.js` (lines 155-175)
- **Description:** Usernames from POST body used in URL construction without validation. Characters like ../, ?, # could alter paths.
- **Remediation:** Validate against strict regex: `/^[a-zA-Z0-9._-]{1,100}$/`.
- **PR-ready:** yes
- **Action taken:** PR #8 https://github.com/FlorianCasse/credly-scraper/pull/8

### [MEDIUM] Shell Injection via Unquoted jq Output
- **File:** `credly_badge_downloader.sh` (lines 105-115)
- **Description:** Variables from jq used in arithmetic and commands without validation. Unexpected values could cause errors or escape quoting.
- **Remediation:** Validate jq numeric output; use sanitized filenames; prefer printf over bare variables.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [MEDIUM] curl Downloads Without Integrity Verification
- **File:** `credly_badge_downloader.sh` (lines 92-100)
- **Description:** Downloaded images not verified for content type or integrity before processing with ImageMagick.
- **Remediation:** Verify MIME type with file --mime-type; set --max-filesize.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)

### [MEDIUM] Third-Party Script Without Subresource Integrity
- **File:** `index.html` (line 97)
- **Description:** JSZip loaded from cdnjs without integrity attribute. CDN compromise would execute malicious JS.
- **Remediation:** Add integrity and crossorigin attributes to script tag.
- **PR-ready:** yes
- **Action taken:** PR #9 https://github.com/FlorianCasse/credly-scraper/pull/9

### [MEDIUM] No Content-Security-Policy Meta Tag
- **File:** `index.html` (lines 2-7)
- **Description:** No CSP via header or meta tag. XSS vulnerabilities can load arbitrary scripts and exfiltrate data.
- **Remediation:** Add strict CSP meta tag allowing only self and required CDN origins.
- **PR-ready:** yes
- **Action taken:** PR #9 https://github.com/FlorianCasse/credly-scraper/pull/9

### [MEDIUM] Password Cached in JavaScript Memory
- **File:** `script.js` (lines 529-535)
- **Description:** Plaintext password stored in sessionPassword module variable. Any XSS exploit can read and exfiltrate it.
- **Remediation:** Use proper session mechanism (HttpOnly cookie); don't cache plaintext password.
- **PR-ready:** yes
- **Action taken:** PR #9 https://github.com/FlorianCasse/credly-scraper/pull/9

### [MEDIUM] Cache Poisoning via Unvalidated Content-Type
- **File:** `server.js` (lines 99-113)
- **Description:** Upstream content-type not validated before caching. Error pages cached and served as data.
- **Remediation:** Only cache expected content-types (application/json, image/png, etc.).
- **PR-ready:** yes
- **Action taken:** PR #8 https://github.com/FlorianCasse/credly-scraper/pull/8

### [LOW] Server Port Defaults to All Interfaces
- **File:** `server.js` (line 6)
- **Description:** app.listen without bind address exposes service on all interfaces.
- **Remediation:** Bind to 127.0.0.1 in development; use reverse proxy in production.
- **PR-ready:** yes
- **Action taken:** PR #7 https://github.com/FlorianCasse/credly-scraper/pull/7

### [LOW] Express Pinned to Semver Range
- **File:** `package.json` (line 8)
- **Description:** ^4.21.0 allows any 4.x release, potentially including vulnerable patches.
- **Remediation:** Pin exact version; commit package-lock.json; add npm audit to CI.
- **PR-ready:** yes
- **Action taken:** PR #10 https://github.com/FlorianCasse/credly-scraper/pull/10

### [LOW] No package-lock.json Committed
- **File:** `package.json` (lines 1-11)
- **Description:** Without lockfile, builds are non-deterministic and may pull malicious packages.
- **Remediation:** Generate and commit package-lock.json; use npm ci in CI/CD.
- **PR-ready:** yes
- **Action taken:** PR #10 https://github.com/FlorianCasse/credly-scraper/pull/10

### [LOW] No Request Body Size Limit
- **File:** `server.js` (line 13)
- **Description:** express.json() called without limit option. Default 100KB but explicit limit is better practice.
- **Remediation:** Set explicit limit: `express.json({ limit: '16kb' })`.
- **PR-ready:** yes
- **Action taken:** PR #7 https://github.com/FlorianCasse/credly-scraper/pull/7

### [LOW] Shell Script Missing set -u and set -o pipefail
- **File:** `credly_badge_downloader.sh` (line 1)
- **Description:** Without set -u and pipefail, unset variables and pipe failures are silently ignored.
- **Remediation:** Add `set -euo pipefail` at the top of the script.
- **PR-ready:** yes
- **Action taken:** Noted in report (issues disabled in repo)
