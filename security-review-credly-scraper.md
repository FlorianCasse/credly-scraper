# Security Review Report: credly-scraper

**Repository:** FlorianCasse/credly-scraper
**Review Date:** 2026-05-27
**Reviewer:** Claude (Automated Security Review)
**Total Findings:** 17

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 3 |
| MEDIUM | 6 |
| LOW | 6 |

---

## CRITICAL Findings

### Finding 1: Hardcoded password with insecure fallback

**Severity:** CRITICAL
**File:** `server.js` (line 8)
**Status:** Fixed in PR

**Description:**
The server password is hardcoded as a fallback value: `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`. If the `APP_PASSWORD` environment variable is not set, the application falls back to a well-known password that is committed to the public repository. Any attacker who reads the source code can authenticate.

**Remediation:**
Remove the hardcoded fallback. Require `APP_PASSWORD` to be set as an environment variable and exit with an error if it is missing.

---

### Finding 2: SSRF via open proxy to arbitrary ports and protocols

**Severity:** CRITICAL
**File:** `server.js` (line 91)
**Status:** Fixed in PR

**Description:**
The `/api/credly` proxy endpoint validates the hostname against an allowlist but does not validate the protocol or port. An attacker could craft a URL like `http://www.credly.com:8080/internal-admin` or use a non-HTTPS protocol to probe internal services. While the `https.get` call limits to HTTPS, the URL parsing does not enforce this constraint, and future code changes could introduce HTTP support.

**Remediation:**
Explicitly validate that `parsed.protocol === 'https:'` and that `parsed.port` is either empty or `'443'`.

---

## HIGH Findings

### Finding 3: Password transmitted in plaintext without HTTPS enforcement

**Severity:** HIGH
**File:** `server.js` (line 302)
**Status:** Open (requires infrastructure change)

**Description:**
The password is sent as plaintext in JSON request bodies for `POST /api/profiles` and `DELETE /api/profiles`. The server does not enforce HTTPS or set HSTS headers. If the server is accessed over HTTP, the password is transmitted in cleartext and can be intercepted by network attackers.

**Remediation:**
Enforce HTTPS by adding HSTS headers and redirecting HTTP to HTTPS. Better yet, replace the shared password scheme with proper authentication (e.g., API tokens, session cookies with httpOnly/secure flags).

---

### Finding 4: Timing attack on password comparison

**Severity:** HIGH
**File:** `server.js` (lines 304, 338)
**Status:** Fixed in PR

**Description:**
The password comparison uses `password !== PASSWORD` which is vulnerable to timing attacks. An attacker can measure response times to determine the password character by character, as the string comparison short-circuits on the first mismatched character.

**Remediation:**
Use `crypto.timingSafeEqual()` for password comparison to ensure constant-time comparison regardless of input.

---

### Finding 5: No request body size limit enables DoS

**Severity:** HIGH
**File:** `server.js` (line 11)
**Status:** Fixed in PR

**Description:**
The Express JSON body parser is used without a size limit (`app.use(express.json())`). An attacker can send extremely large JSON payloads to exhaust server memory and cause a denial-of-service.

**Remediation:**
Add a body size limit: `app.use(express.json({ limit: '100kb' }));`

---

## MEDIUM Findings

### Finding 6: No rate limiting on API endpoints

**Severity:** MEDIUM
**File:** `server.js` (line 86)
**Status:** Open (requires additional dependency)

**Description:**
None of the API endpoints have rate limiting. The `/api/credly` proxy and batch endpoints make outbound requests to Credly, so an attacker could use the server as an amplification proxy. The password-protected endpoints are vulnerable to brute-force attacks.

**Remediation:**
Add rate limiting middleware such as `express-rate-limit`. Apply stricter limits to the authentication endpoints (e.g., 5 attempts per minute per IP) and moderate limits to the proxy/batch endpoints (e.g., 30 requests per minute per IP).

---

### Finding 7: No CORS configuration allows any origin to call API endpoints

**Severity:** MEDIUM
**File:** `server.js` (line 1)
**Status:** Open (requires design decision)

**Description:**
The Express server does not configure CORS headers. If cross-origin access is needed (e.g., from GitHub Pages frontend on a different origin), CORS should be configured explicitly and securely with a specific allowlist of origins.

**Remediation:**
If cross-origin access is needed, add the `cors` middleware with a specific allowlist of origins. If not needed, document this decision.

---

### Finding 8: No input validation on username parameter enables path traversal

**Severity:** MEDIUM
**File:** `server.js` (line 252)
**Status:** Fixed in PR

**Description:**
The batch endpoints accept usernames that are interpolated into URLs like `https://www.credly.com/users/${username}/badges.json`. Without validation, an attacker could supply path traversal sequences (e.g., `../admin`) or special characters to manipulate the URL.

**Remediation:**
Add username format validation with a regex like `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/` before using the username in URL construction.

---

### Finding 9: No input length validation on profile fields

**Severity:** MEDIUM
**File:** `server.js` (lines 327-328)
**Status:** Fixed in PR

**Description:**
The `country` and `url` fields in the profile creation endpoint have no length limits beyond basic type checking. An attacker could submit extremely long strings to waste storage or cause issues with the JSON data file.

**Remediation:**
Add length validation: country max 100 characters, URL max 500 characters.

---

### Finding 10: External script loaded without Subresource Integrity (SRI)

**Severity:** MEDIUM
**File:** `index.html` (line 129)
**Status:** Fixed in PR

**Description:**
The JSZip library is loaded from a CDN (`cdnjs.cloudflare.com`) without an `integrity` attribute. If the CDN is compromised, an attacker could inject malicious JavaScript that executes in users' browsers with full access to the page.

**Remediation:**
Add `integrity` and `crossorigin` attributes to the script tag to ensure the browser verifies the script content before execution.

---

### Finding 11: Cache has no per-entry size limit

**Severity:** MEDIUM
**File:** `server.js` (line 75)
**Status:** Fixed in PR

**Description:**
The in-memory cache has a total size limit of 100 MB but no per-entry size limit. A single large response from Credly could consume a disproportionate amount of cache space, evicting many smaller entries.

**Remediation:**
Add a maximum entry size check (e.g., 10 MB) and skip caching for entries that exceed it.

---

## LOW Findings

### Finding 12: Shell script vulnerable to command injection via crafted filenames

**Severity:** LOW
**File:** `credly_badge_downloader.sh` (line 264)
**Status:** Open

**Description:**
Variables like `$badge_name` and `$ocr_text` are used in file paths and commands without proper quoting in some places. While the `sanitize_filename` function helps, certain characters could still cause issues.

**Remediation:**
Ensure all variable expansions are double-quoted, especially in file path construction. Use `"${variable}"` consistently throughout the script.

---

### Finding 13: No .env file in .gitignore risks secret leakage

**Severity:** LOW
**File:** `.gitignore`
**Status:** Fixed in PR

**Description:**
The `.gitignore` file does not include entries for `.env` files. If a developer creates a `.env` file with the `APP_PASSWORD` or other secrets, it could be accidentally committed to the repository.

**Remediation:**
Add `.env`, `.env.*`, and `.env.local` to `.gitignore`.

---

### Finding 14: Error messages may leak internal state

**Severity:** LOW
**File:** `server.js` (line 127)
**Status:** Open

**Description:**
The proxy error handler logs the full error message and returns a generic error to the client, which is good. However, the `upstream.pipe(res)` on non-200 responses (line 112-113) forwards the upstream response directly, which could include Credly-specific error messages or internal details.

**Remediation:**
Consider returning generic error messages for non-200 upstream responses instead of piping the upstream body directly.

---

### Finding 15: Synchronous file I/O blocks event loop

**Severity:** LOW
**File:** `server.js` (lines 22, 30)
**Status:** Open

**Description:**
The `readProfiles()` and `writeProfiles()` functions use synchronous file I/O (`readFileSync`, `writeFileSync`). Under load, these block the Node.js event loop and can cause request timeouts for other clients.

**Remediation:**
Replace with asynchronous alternatives (`fs.promises.readFile`, `fs.promises.writeFile`) and add proper error handling.

---

### Finding 16: No Content-Security-Policy headers

**Severity:** LOW
**File:** `server.js` / `index.html`
**Status:** Open

**Description:**
The application does not set Content-Security-Policy (CSP) headers. This leaves the application more vulnerable to XSS attacks if any user-controlled content is rendered.

**Remediation:**
Add CSP headers via middleware (e.g., `helmet`) to restrict script sources, style sources, and other resource loading to trusted origins.

---

### Finding 17: Predefined profiles hardcoded in multiple locations

**Severity:** LOW
**File:** `server.js` (line 370)
**Status:** Open

**Description:**
The predefined profiles list is duplicated between `server.js` (for cache prewarming) and `script.js` (for the frontend). This duplication means changes need to be synchronized across files, increasing the risk of inconsistency and making the codebase harder to maintain.

**Remediation:**
Extract the predefined profiles to a shared JSON configuration file that both server and client reference.

---

## Findings Addressed in PR

The following findings have been addressed in PR #28 (`security/credly-scraper-hardening`):

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | CRITICAL | Hardcoded password | Required `APP_PASSWORD` env var, removed fallback |
| 2 | CRITICAL | SSRF via open proxy | Added protocol and port validation |
| 4 | HIGH | Timing attack on password | Replaced with `crypto.timingSafeEqual()` |
| 5 | HIGH | No body size limit | Added `express.json({ limit: '100kb' })` |
| 8 | MEDIUM | Username path traversal | Added `isValidUsername()` format validation |
| 9 | MEDIUM | No input length validation | Added max length checks for country and URL |
| 10 | MEDIUM | No SRI on external script | Added `integrity` and `crossorigin` attributes |
| 11 | MEDIUM | No per-entry cache limit | Added 10 MB max entry size check |
| 13 | LOW | No .env in .gitignore | Added `.env`, `.env.*`, `.env.local` entries |

## Findings Requiring Separate Action

| # | Severity | Finding | Reason |
|---|----------|---------|--------|
| 3 | HIGH | Plaintext password over HTTP | Requires infrastructure/deployment change |
| 6 | MEDIUM | No rate limiting | Requires adding `express-rate-limit` dependency |
| 7 | MEDIUM | No CORS configuration | Requires design decision on cross-origin policy |
| 12 | LOW | Shell script quoting | Requires careful audit of all variable expansions |
| 14 | LOW | Error message leakage | Requires decision on error handling strategy |
| 15 | LOW | Synchronous file I/O | Requires refactoring to async patterns |
| 16 | LOW | No CSP headers | Requires adding `helmet` or similar middleware |
| 17 | LOW | Duplicated profile list | Requires refactoring to shared config |
