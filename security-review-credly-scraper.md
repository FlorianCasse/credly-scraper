# Security Review: credly-scraper

**Date:** 2026-04-16
**Reviewer:** Claude (automated security review)
**Language/Framework:** Node.js / Express
**Dependency Manager:** npm (package.json)

## Summary
- Total findings: 5
- Critical: 1 | High: 1 | Medium: 2 | Low: 1
- PRs opened: 1 (https://github.com/FlorianCasse/credly-scraper/pull/12)
- Issues opened: 0 (Issues are disabled in this repository; findings documented in this report and in PR #12)

## Findings

### [CRITICAL] Hardcoded password fallback in server.js
- **File:** `server.js` (line 10)
- **Description:** The `PASSWORD` constant uses a hardcoded fallback value `certificationitq1!` when the `APP_PASSWORD` environment variable is not set. Since this is a public repository, anyone can read this password and use it to add/remove Credly profiles via the API.
- **Remediation:** Remove the hardcoded fallback. Require `APP_PASSWORD` to be set as an environment variable; exit the process if it is missing.
- **PR-ready:** yes
- **Action taken:** PR #12 https://github.com/FlorianCasse/credly-scraper/pull/12

### [HIGH] XSS risk via innerHTML with untrusted external data
- **File:** `script.js` (multiple locations: `createBadgeCard()`, `createCommonCard()`, `renderByCertification()`)
- **Description:** Multiple functions use `.innerHTML` to render badge data received from the Credly API without sanitization. Badge names, issuer names, and descriptions containing HTML/script tags would be executed in the user's browser.
- **Remediation:** Replace `.innerHTML` assignments with safe DOM manipulation (`textContent`, `createElement()`) or use a sanitization library like DOMPurify.
- **PR-ready:** no (extensive refactor across many functions)
- **Action taken:** Documented in this report (issues disabled in repo)

### [MEDIUM] Missing security headers on Express server
- **File:** `server.js`
- **Description:** The Express server does not use `helmet` middleware or set any security headers (`X-Content-Type-Options`, `X-Frame-Options`, `CSP`, `HSTS`, `Referrer-Policy`).
- **Remediation:** Add `helmet` as a dependency and apply it as middleware.
- **PR-ready:** no (requires new dependency)
- **Action taken:** Documented in this report (issues disabled in repo)

### [MEDIUM] No rate limiting on API endpoints
- **File:** `server.js`
- **Description:** No rate limiting is configured. Password-protected endpoints are vulnerable to brute-force attacks. The proxy and batch endpoints can be abused for DoS.
- **Remediation:** Add `express-rate-limit` and apply strict limits to auth endpoints and general limits to all others.
- **PR-ready:** no (requires new dependency and architectural decisions)
- **Action taken:** Documented in this report (issues disabled in repo)

### [LOW] No HTTPS enforcement
- **File:** `server.js`
- **Description:** The server runs on plain HTTP. The password transmitted to profile management endpoints is sent in cleartext.
- **Remediation:** Deploy behind a TLS-terminating reverse proxy or add native HTTPS support.
- **PR-ready:** no (deployment infrastructure concern)
- **Action taken:** Documented in this report (issues disabled in repo)

## Areas Checked (No Issues Found)
- **Hardcoded secrets (other than password):** No API keys or tokens found in source
- **Dependency vulnerabilities:** `express ^4.21.0` is current; no known high-severity CVEs
- **SSRF in proxy:** The `/api/credly` proxy validates hostnames against an allowlist — adequate protection
- **File system access:** File operations are limited to the `data/` directory with controlled paths
- **Injection risks:** No SQL or command injection vectors found
