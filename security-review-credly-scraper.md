# Security Review: credly-scraper

**Date:** 2026-04-10
**Reviewer:** Automated (Claude)
**Repository:** floriancasse/credly-scraper
**Stack:** Node.js, Express, vanilla JS (client-side), GitHub Pages

## Summary
- Total findings: 20
- Critical: 1 | High: 4 | Medium: 8 | Low: 7
- PRs opened: 6 (across reviews)
- Issues opened: 0 (issue tracker is disabled on this repository; non-PR-ready findings documented below)

### PRs
- PR #1: Remove hardcoded default password — https://github.com/FlorianCasse/credly-scraper/pull/1
- PR #2: Add SSRF protections to proxy endpoint — https://github.com/FlorianCasse/credly-scraper/pull/2
- PR #3: Address critical security vulnerabilities — https://github.com/FlorianCasse/credly-scraper/pull/3
- PR #4: Remove hardcoded password fallback — https://github.com/FlorianCasse/credly-scraper/pull/4
- PR #5: Security headers, SRI, XSS sanitization — https://github.com/FlorianCasse/credly-scraper/pull/5
- PR #6: Username validation to prevent path traversal — https://github.com/FlorianCasse/credly-scraper/pull/6

### Issues
> **Note:** GitHub Issues are disabled on this repository. Non-PR-ready findings are documented in the Findings section below and marked with "Action taken: Documented in report (issues disabled)."

## Findings

### [CRITICAL] Hardcoded Default Password in Source Code
- **File:** `server.js` (line 8)
- **Description:** A plaintext default password (`certificationitq1!`) is hardcoded as a fallback when `APP_PASSWORD` env var is not set. Anyone can read the source code and use this password to add or remove profiles via the `/api/profiles` endpoints.
- **Remediation:** Remove the hardcoded default. Require `APP_PASSWORD` as a mandatory environment variable. Exit if not set.
- **PR-ready:** yes
- **Action taken:** PR #1, PR #3, PR #4

### [HIGH] Password Sent in Plaintext Without Timing-Safe Comparison
- **File:** `server.js` (lines 218-220, 239-241), `script.js`
- **Description:** Password comparison uses simple string equality (`password !== PASSWORD`), vulnerable to timing attacks. No HTTPS enforcement or HSTS. Password travels in cleartext without TLS.
- **Remediation:** Use crypto.timingSafeEqual() for comparison. Add HSTS. Consider proper session-based auth.
- **PR-ready:** no (architectural change needed)
- **Action taken:** Documented in report (issues disabled)

### [HIGH] XSS via innerHTML with Unsanitized Badge Data
- **File:** `script.js` (multiple locations: createBadgeCard ~line 259, createCommonCard ~line 302, renderByCertification ~line 340, initQuickSelect ~line 530)
- **Description:** Badge names, issuer names, holder names, and other Credly API data injected directly into DOM via innerHTML template literals without HTML escaping. Attacker-controlled badge data could execute arbitrary JavaScript.
- **Remediation:** Add escapeHtml() utility and apply to all dynamic values before innerHTML insertion.
- **PR-ready:** yes
- **Action taken:** PR #5

### [HIGH] Server-Side Request Forgery (SSRF) via Open Proxy
- **File:** `server.js` (lines 84-113)
- **Description:** The /api/credly proxy accepts URLs and makes outbound requests. Host allowlist exists but bypass vectors include DNS rebinding, URL parsing tricks, and no path restriction.
- **Remediation:** Stricter URL validation, IP-level validation after DNS resolution, restrict allowed paths.
- **PR-ready:** partial
- **Action taken:** PR #2. Remaining architectural concerns documented in report (issues disabled).

### [HIGH] Static File Serving Exposes Entire Application Directory
- **File:** `server.js` (line 12)
- **Description:** `express.static(__dirname)` serves the entire app directory including server.js (with hardcoded password), package.json, and data files. Visiting /server.js in a browser reveals server code.
- **Remediation:** Serve static files from a dedicated public/ subdirectory.
- **PR-ready:** yes
- **Action taken:** Documented in report (requires file restructuring; issues disabled)

### [MEDIUM] No Rate Limiting on Any Endpoints
- **File:** `server.js` (all endpoints)
- **Description:** No rate limiting anywhere. /api/profiles can be brute-forced, /api/credly can amplify traffic, batch endpoints enable amplification attacks.
- **Remediation:** Add express-rate-limit middleware with stricter limits on auth endpoints.
- **PR-ready:** yes
- **Action taken:** PR #3

### [MEDIUM] No Security Headers
- **File:** `server.js` (entire file)
- **Description:** Missing CSP, X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy.
- **Remediation:** Add helmet npm package.
- **PR-ready:** yes
- **Action taken:** PR #3, PR #5

### [MEDIUM] Denial of Service via Unbounded Cache Memory
- **File:** `server.js` (lines 40-78, 106)
- **Description:** Buffer.concat(chunks) has no size limit. Large upstream responses allocate unbounded memory.
- **Remediation:** Set max response body size, use LRU cache library, limit cache keys per IP.
- **PR-ready:** partial
- **Action taken:** Documented in report (issues disabled)

### [MEDIUM] GitHub Pages Deployment Exposes Server-Side Code
- **File:** `.github/workflows/deploy.yml` (line 27)
- **Description:** Pages deployment uploads entire repository root (path: '.'), exposing server.js, package.json, and data files.
- **Remediation:** Deploy only client-side files from a dist/ folder.
- **PR-ready:** yes
- **Action taken:** Documented in report (issues disabled)

### [MEDIUM] express.json() Body Parser Has No Size Limit
- **File:** `server.js` (line 11)
- **Description:** JSON body parser without explicit size limit. Large POST bodies consume server memory.
- **Remediation:** Set explicit limit: `express.json({ limit: '10kb' })`.
- **PR-ready:** yes
- **Action taken:** PR #3

### [MEDIUM] Race Condition on Data File Operations
- **File:** `server.js` (lines 9, 22-28)
- **Description:** Synchronous fs operations with no locking for concurrent writes. country field has no validation.
- **Remediation:** Use file-locking, validate field lengths, consider a database.
- **PR-ready:** partial
- **Action taken:** Documented in report (issues disabled)

### [MEDIUM] Third-Party CDN Script Without SRI
- **File:** `index.html` (line 117)
- **Description:** JSZip loaded from cdnjs without integrity attribute. CDN compromise injects malicious JS.
- **Remediation:** Add SRI integrity hash and crossorigin="anonymous".
- **PR-ready:** yes
- **Action taken:** PR #3, PR #5

### [MEDIUM] No Input Validation on Username Parameter
- **File:** `server.js` (lines 161-212)
- **Description:** Usernames interpolated into URLs without validation. Malicious usernames could manipulate URL construction.
- **Remediation:** Validate with strict regex: `/^[a-zA-Z0-9._-]+$/`.
- **PR-ready:** yes
- **Action taken:** PR #6

### [MEDIUM] data/ Directory Deployed to GitHub Pages
- **File:** `.github/workflows/deploy.yml`, `.gitignore`
- **Description:** data/ directory not in .gitignore. If custom-profiles.json exists locally and is committed, it deploys to Pages.
- **Remediation:** Add data/ to .gitignore and restrict Pages deploy path.
- **PR-ready:** yes
- **Action taken:** Documented in report (issues disabled)

### [LOW] No CORS Configuration
- **File:** `server.js` (entire file)
- **Description:** No CORS configuration. GET endpoints freely accessible cross-origin.
- **Remediation:** Add explicit CORS configuration restricting allowed origins.
- **PR-ready:** yes
- **Action taken:** Documented in report (issues disabled)

### [LOW] Sensitive Error Details Leaked to Client
- **File:** `server.js` (lines 108-112, 203)
- **Description:** Non-200 upstream responses piped directly to client. Raw error messages exposed.
- **Remediation:** Return generic error messages; log details server-side.
- **PR-ready:** yes
- **Action taken:** Documented in report (issues disabled)

### [LOW] No package-lock.json in Repository
- **File:** Repository root (missing)
- **Description:** No lockfile committed. Builds non-reproducible, vulnerable to dependency confusion.
- **Remediation:** Run npm install, commit package-lock.json, consider pinning exact Express version.
- **PR-ready:** yes
- **Action taken:** Documented in report (issues disabled)

### [LOW] Shell Script Variable Quoting Issues
- **File:** `credly_badge_downloader.sh` (multiple lines)
- **Description:** Some variable expansions not properly double-quoted, risking word splitting with special characters.
- **Remediation:** Ensure all variable expansions are double-quoted.
- **PR-ready:** yes (minor)
- **Action taken:** Documented in report (issues disabled)

### [LOW] data/ Directory Not in .gitignore
- **File:** `.gitignore`
- **Description:** Runtime data/ directory not listed in .gitignore. Could be accidentally committed.
- **Remediation:** Add `data/` to .gitignore.
- **PR-ready:** yes
- **Action taken:** Documented in report (issues disabled)

### [LOW] Password Cached in Client-Side JavaScript Memory
- **File:** `script.js` (line ~521)
- **Description:** sessionPassword caches plaintext password for page session. Accessible to XSS exploits or browser extensions.
- **Remediation:** Implement server-side sessions with HTTP-only cookies.
- **PR-ready:** no (architectural change)
- **Action taken:** Documented in report (issues disabled)
