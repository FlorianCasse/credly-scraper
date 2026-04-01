# Security Review: credly-scraper

**Date:** 2026-04-01
**Reviewed by:** Claude (Automated Security Review)
**Language/Framework:** Node.js / Express
**Dependency Manager:** npm (package.json)

## Summary
- Total findings: 12
- Critical: 2 | High: 3 | Medium: 4 | Low: 3
- PRs opened: 1 ([PR #3](https://github.com/FlorianCasse/credly-scraper/pull/3))
- Issues opened: 0 (Issues are disabled on this repository)

> **Note:** GitHub Issues are disabled on this repository. All findings that would have been filed as issues are documented in this report instead. Non-PR findings should be tracked separately.

## Findings

### [CRITICAL] Hardcoded Default Password
- **File:** `server.js` (line 8)
- **Description:** A hardcoded default password `certificationitq1!` is embedded as a fallback when `APP_PASSWORD` env var is not set. This password is visible in source code and Git history, allowing unauthorized modification of profiles.
- **Remediation:** Remove the hardcoded fallback. Require `APP_PASSWORD` to be explicitly set; disable profile endpoints if unset.
- **PR-ready:** yes
- **Action taken:** PR #3 https://github.com/FlorianCasse/credly-scraper/pull/3

### [CRITICAL] XSS Vulnerability via Unsanitized innerHTML
- **File:** `script.js` (lines 319-328, 406-413, 453-461, 923-927)
- **Description:** User-controlled data (country names, usernames from custom profiles) is inserted directly into `innerHTML` without sanitization. An attacker could inject malicious HTML/JavaScript via crafted profile data.
- **Remediation:** Use `textContent` instead of `innerHTML` for plain text, or create an `escapeHtml()` sanitization function for all user-derived content.
- **PR-ready:** no (requires significant refactoring of DOM construction patterns)
- **Action taken:** Documented in this report (Issues disabled on repo)

### [HIGH] Missing Security Headers
- **File:** `server.js` (lines 1-12)
- **Description:** No security headers configured (CSP, X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy).
- **Remediation:** Add `helmet` middleware: `app.use(helmet())`.
- **PR-ready:** yes
- **Action taken:** PR #3 https://github.com/FlorianCasse/credly-scraper/pull/3

### [HIGH] No Rate Limiting on Password-Protected Endpoints
- **File:** `server.js` (lines 301-356)
- **Description:** POST and DELETE `/api/profiles` endpoints lack rate limiting, enabling brute-force password attacks.
- **Remediation:** Add `express-rate-limit` middleware to authentication endpoints.
- **PR-ready:** yes
- **Action taken:** PR #3 https://github.com/FlorianCasse/credly-scraper/pull/3

### [HIGH] Path Traversal Risk in Shell Script
- **File:** `credly_badge_downloader.sh` (lines 241, 268-323)
- **Description:** Username extracted from URLs is used in directory creation without sanitizing path traversal characters (`../`). A crafted username could create directories outside the intended location.
- **Remediation:** Validate username with strict regex: `[[ ! "$username" =~ ^[a-zA-Z0-9._-]+$ ]]`
- **PR-ready:** no (shell script needs broader security review)
- **Action taken:** Documented in this report (Issues disabled on repo)

### [HIGH] Data File Stored with Default Permissions
- **File:** `server.js` (lines 360-361)
- **Description:** `custom-profiles.json` is created without explicit file permissions. Default umask may allow other users on the system to read profile data.
- **Remediation:** Set `mode: 0o700` on directory and `0o600` on data file.
- **PR-ready:** no (requires testing on deployment environment)
- **Action taken:** Documented in this report (Issues disabled on repo)

### [MEDIUM] Session Password Cached Indefinitely
- **File:** `script.js` (line 1002)
- **Description:** Password cached in global `sessionPassword` variable, never cleared. Persists for entire browser session.
- **Remediation:** Add timeout to clear cached password; clear on `visibilitychange` event.
- **PR-ready:** no
- **Action taken:** Documented in this report (Issues disabled on repo)

### [MEDIUM] No HTTPS Enforcement
- **File:** `server.js`
- **Description:** No HTTPS redirect or HSTS headers. Passwords transmitted in plain text without infrastructure-level HTTPS.
- **Remediation:** Add HTTPS redirect middleware for production and HSTS header.
- **PR-ready:** no
- **Action taken:** Documented in this report (Issues disabled on repo)

### [MEDIUM] Missing Input Validation on Country Field
- **File:** `server.js` (lines 307-309)
- **Description:** No maximum length or character validation on country field. Attacker could submit very long strings or XSS payloads.
- **Remediation:** Add length limit (100 chars) and character whitelist validation.
- **PR-ready:** no
- **Action taken:** Documented in this report (Issues disabled on repo)

### [MEDIUM] No Request Body Size Limits
- **File:** `server.js` (line 11)
- **Description:** `express.json()` uses default 100kb limit. Should be explicitly restricted.
- **Remediation:** Set `express.json({ limit: '10kb' })`.
- **PR-ready:** yes
- **Action taken:** PR #3 https://github.com/FlorianCasse/credly-scraper/pull/3

### [LOW] JSZip CDN Missing SRI Hash
- **File:** `index.html` (line 127)
- **Description:** JSZip loaded from CDN without Subresource Integrity check. Supply chain risk if CDN is compromised.
- **Remediation:** Add `integrity` and `crossorigin="anonymous"` attributes.
- **PR-ready:** yes
- **Action taken:** PR #3 https://github.com/FlorianCasse/credly-scraper/pull/3

### [LOW] Error Messages Expose Technical Details
- **File:** `script.js` (lines 687-691)
- **Description:** Server error messages displayed directly to users, potentially revealing API internal information.
- **Remediation:** Show generic error messages to users; log details server-side.
- **PR-ready:** no
- **Action taken:** Documented in this report (Issues disabled on repo)
