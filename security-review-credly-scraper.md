# Security Review: credly-scraper

**Date:** 2026-04-16
**Reviewer:** Claude (automated security review)
**Language:** JavaScript / Node.js
**Framework:** Express.js 4.21.x + Vanilla JS frontend
**Dependency Manager:** npm

## Summary
- Total findings: 16
- Critical: 1 | High: 2 | Medium: 5 | Low: 8
- PRs opened: 1 ([PR #11](https://github.com/FlorianCasse/credly-scraper/pull/11))
- Issues opened: 0 (Issues are disabled on this repository)

> **Note:** GitHub Issues are disabled on this repository. Non-PR-ready findings are documented below but could not be filed as Issues. Consider enabling Issues or tracking these in an alternative system.

## Findings

### [CRITICAL] Hardcoded Password Fallback in Source Code
- **File:** `server.js` (line 8)
- **Description:** A plaintext password `certificationitq1!` is hardcoded as a fallback when the `APP_PASSWORD` environment variable is not set. This password is visible in git history, available to anyone with repository access, and uses a weak pattern (dictionary word + number + symbol).
- **Remediation:** Require `APP_PASSWORD` as a mandatory environment variable with no fallback. Exit on startup if missing. Rotate the leaked credential. Scrub git history with BFG Repo-Cleaner.
- **PR-ready:** yes
- **Action taken:** PR #11 https://github.com/FlorianCasse/credly-scraper/pull/11

### [HIGH] Password Transmitted in Plaintext Without HTTPS Enforcement
- **File:** `script.js` (lines 976, 983, 1099, 1108)
- **Description:** Authentication passwords are sent via HTTP POST requests in JSON bodies without any enforcement of HTTPS connections, allowing potential interception by MITM attacks.
- **Remediation:** Install `helmet` with HSTS enforcement. Add middleware to redirect HTTP to HTTPS. Consider replacing password-based auth with session tokens.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [HIGH] Missing Security Headers on Express Application
- **File:** `server.js` (global)
- **Description:** No security headers are configured. Missing: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security.
- **Remediation:** Install and configure `helmet` package.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [MEDIUM] DOM-Based XSS via innerHTML in Frontend
- **File:** `script.js` (lines 319-331, 406-414, 453-464, 923-927)
- **Description:** Badge data from API responses is inserted into the DOM using `innerHTML` with template literals. While data comes from the trusted Credly API, defense-in-depth requires output encoding.
- **Remediation:** Use `textContent` instead of `innerHTML` for user-provided data, or use DOMPurify.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [MEDIUM] Static File Serving Exposes Project Root Directory
- **File:** `server.js` (line 12)
- **Description:** Express static middleware serves from `__dirname` (project root), potentially exposing `.git/` directory contents, `.gitignore`, and config files.
- **Remediation:** Move static assets to a `public/` subdirectory and serve from there.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [MEDIUM] Missing Rate Limiting on All API Endpoints
- **File:** `server.js` (multiple endpoints)
- **Description:** No rate limiting is configured. Profile creation, deletion, and batch badge requests can all be abused for DoS or spam.
- **Remediation:** Install `express-rate-limit` and configure per-endpoint limits.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [MEDIUM] Password Cached in Client-Side JavaScript Memory
- **File:** `script.js` (lines 1001-1002)
- **Description:** Once entered, the password is stored in a JavaScript variable (`sessionPassword`) for the entire session. Accessible via DevTools and extractable via XSS.
- **Remediation:** Implement server-side sessions with secure HTTP-only cookies.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [MEDIUM] No CSRF Protection on State-Changing Endpoints
- **File:** `server.js` (POST/DELETE `/api/profiles`)
- **Description:** No CSRF token validation on endpoints that modify server-side data. A malicious website could forge requests to add or delete profiles.
- **Remediation:** Install `csurf` and `cookie-parser`, integrate CSRF tokens into frontend.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [MEDIUM] Country Field Input Validation Insufficient
- **File:** `server.js` (lines 307-325)
- **Description:** Country field accepts any string without length or character restrictions. Could lead to memory exhaustion with very long strings.
- **Remediation:** Add length limit and character pattern validation.
- **PR-ready:** yes
- **Action taken:** PR #11 https://github.com/FlorianCasse/credly-scraper/pull/11

### [LOW] Error Messages Leak Internal Information
- **File:** `server.js` (line 281)
- **Description:** Raw `err.message` from upstream API calls is exposed to clients in the SSE stream, potentially revealing internal API structure.
- **Remediation:** Return generic error messages; log details server-side only.
- **PR-ready:** yes
- **Action taken:** PR #11 https://github.com/FlorianCasse/credly-scraper/pull/11

### [LOW] Username Input Validation Missing
- **File:** `server.js` (lines 249-254)
- **Description:** Individual usernames in batch requests are not validated for length or character content.
- **Remediation:** Add regex pattern validation and length limits.
- **PR-ready:** yes
- **Action taken:** PR #11 https://github.com/FlorianCasse/credly-scraper/pull/11

### [LOW] Unbounded Cache Memory Growth
- **File:** `server.js` (lines 40, 50-58)
- **Description:** While a 100 MB cache limit exists, there are no per-entry size limits. An attacker could monopolize cache with large entries.
- **Remediation:** Add per-entry size limit (e.g., 10 MB).
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [LOW] Debug Logging Without Environment Gating
- **File:** `server.js` (lines 127, 392, 405, 409, 414, 418)
- **Description:** Console logging of operational details runs in all environments. Could leak patterns or sensitive information in production.
- **Remediation:** Gate verbose logging behind `NODE_ENV !== 'production'` or use a structured logger like `winston`.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [LOW] External CDN Dependency Without SRI
- **File:** `index.html` (line 127)
- **Description:** JSZip loaded from cdnjs.cloudflare.com without Subresource Integrity hash.
- **Remediation:** Add `integrity` and `crossorigin` attributes, or bundle locally.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [LOW] Missing package-lock.json
- **File:** `package.json`
- **Description:** No lock file present. Caret versioning allows installing newer versions that could introduce vulnerabilities.
- **Remediation:** Run `npm install`, commit `package-lock.json`, use `npm ci` in production.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)

### [LOW] Weak Password Policy
- **File:** `server.js` (line 8)
- **Description:** The default password follows a predictable pattern (word + number + symbol). No password strength requirements enforced.
- **Remediation:** Enforce minimum length and complexity requirements. Related to the CRITICAL hardcoded credential finding.
- **PR-ready:** no
- **Action taken:** Could not open issue (Issues disabled on repository)
