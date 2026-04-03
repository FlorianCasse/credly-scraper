# Security Review: credly-scraper

## Summary
- Total findings: 12
- Critical: 2 | High: 3 | Medium: 4 | Low: 3
- PRs opened: 3 ([PR #4](https://github.com/FlorianCasse/credly-scraper/pull/4), [PR #5](https://github.com/FlorianCasse/credly-scraper/pull/5), [PR #6](https://github.com/FlorianCasse/credly-scraper/pull/6))
- Issues opened: 0 (Issues are disabled on this repository. 7 non-PR-ready findings documented below.)

### REVIEW-ERROR: Issues Disabled
GitHub Issues are disabled on `floriancasse/credly-scraper`. The 7 non-PR-ready findings below could not be filed as Issues. Please enable Issues on this repository or track them via another mechanism.

## Findings

### [CRITICAL] Hardcoded Default Password in Source Code
- **File:** `server.js` (line 8)
- **Description:** A hardcoded fallback password (`certificationitq1!`) is used when the `APP_PASSWORD` environment variable is not set. This password is visible in source code and git history, and is deployed to GitHub Pages.
- **Remediation:** Remove the fallback password; require `APP_PASSWORD` to be set via environment variable. Exit with error if missing.
- **PR-ready:** yes
- **Action taken:** PR [#4](https://github.com/FlorianCasse/credly-scraper/pull/4)

### [CRITICAL] XSS via Unsanitized innerHTML
- **File:** `script.js` (lines 319-331, 406-414, 453-463, 923-927)
- **Description:** External data from the Credly API (badge names, issuer names, image URLs) and user-supplied data (country names) are inserted into the DOM via `innerHTML` without sanitization. If the Credly API is compromised or returns malicious data, arbitrary JavaScript can be executed in users' browsers.
- **Remediation:** Add an `escapeHtml()` helper function and sanitize all external data before DOM insertion.
- **PR-ready:** yes
- **Action taken:** PR [#5](https://github.com/FlorianCasse/credly-scraper/pull/5)

### [HIGH] Missing Security Headers
- **File:** `server.js` (lines 1-12)
- **Description:** No security headers configured. Missing CSP, X-Content-Type-Options, X-Frame-Options, HSTS, and Referrer-Policy. Application is vulnerable to XSS, clickjacking, and MIME sniffing attacks.
- **Remediation:** Add security header middleware (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).
- **PR-ready:** yes
- **Action taken:** PR [#5](https://github.com/FlorianCasse/credly-scraper/pull/5)

### [HIGH] No Rate Limiting on Authentication Endpoints
- **File:** `server.js` (lines 301-356)
- **Description:** Password-protected POST and DELETE endpoints (`/api/profiles`) lack rate limiting. An attacker can make unlimited password guesses without throttling, enabling brute-force attacks.
- **Remediation:** Implement express-rate-limit with strict limits on authentication endpoints.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.

### [HIGH] Path Traversal in Shell Script
- **File:** `credly_badge_downloader.sh` (lines 66-81)
- **Description:** Username extracted from URL with regex `[^/]+` accepts path traversal characters (`../`). An attacker could create directories outside the intended location using a crafted URL like `https://www.credly.com/users/../../../etc/passwd`.
- **Remediation:** Add strict username validation: only allow `[a-zA-Z0-9._-]+`.
- **PR-ready:** yes
- **Action taken:** PR [#6](https://github.com/FlorianCasse/credly-scraper/pull/6)

### [MEDIUM] No HTTPS Enforcement
- **File:** `server.js` (lines 417-420)
- **Description:** Server listens on HTTP only. Passwords are transmitted in plaintext unless infrastructure provides TLS termination.
- **Remediation:** Add HTTPS redirect middleware or document TLS proxy requirement.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.

### [MEDIUM] Missing Request Body Size Limits
- **File:** `server.js` (line 11)
- **Description:** `express.json()` used without explicit size limit. Default 100KB may be too generous for the endpoints in use. No explicit limit set.
- **Remediation:** Set explicit body size limit: `express.json({ limit: '10kb' })`.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.

### [MEDIUM] Data File Permissions Not Explicitly Set
- **File:** `server.js` (lines 360-361)
- **Description:** `data/custom-profiles.json` created via `fs.mkdirSync` and `fs.writeFileSync` without explicit file permissions. Default umask may allow other users to read/modify profile data.
- **Remediation:** Use `mode: 0o700` for directory and `mode: 0o600` for file creation.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.

### [MEDIUM] No CSRF Protection
- **File:** `server.js` (POST and DELETE `/api/profiles`)
- **Description:** No CSRF token validation on state-changing endpoints. If a victim visits a malicious site while having access to the credly-scraper, an attacker can add/remove profiles.
- **Remediation:** Implement CSRF token validation for all state-changing endpoints.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.

### [LOW] Missing Subresource Integrity on CDN Script
- **File:** `index.html` (line 127)
- **Description:** JSZip loaded from cdnjs.cloudflare.com without SRI hash. If the CDN is compromised, malicious code could be injected.
- **Remediation:** Add `integrity` and `crossorigin` attributes to the script tag.
- **PR-ready:** yes
- **Action taken:** PR [#5](https://github.com/FlorianCasse/credly-scraper/pull/5)

### [LOW] Session Password Cached Indefinitely
- **File:** `script.js` (lines 991, 1002, 1099, 1124)
- **Description:** Password cached in a global JavaScript variable for the entire browser session with no timeout or clearing mechanism.
- **Remediation:** Add a timeout (e.g., 5 minutes) to clear the cached password.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.

### [LOW] Error Message Information Disclosure
- **File:** `script.js` (lines 633, 657, 714)
- **Description:** Server error messages displayed directly to users, potentially revealing API implementation details.
- **Remediation:** Display generic error messages to users; log details to console for debugging.
- **PR-ready:** no
- **Action taken:** No Issue filed (Issues disabled). Tracked in this report.
