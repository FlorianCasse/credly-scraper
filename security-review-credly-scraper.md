# Security Review: credly-scraper

**Date:** 2026-04-24 (re-run — prior review 2026-04-17)
**Reviewer:** Claude (automated security review)
**Language/Framework:** Node.js / Express
**Dependency Manager:** npm (package.json)

## Status: Findings Unchanged on `main`; 12 Existing PRs Still Open

This re-run confirms that all previously identified findings remain present on `main` @ `9cef95f9`. Twelve PRs (#1–#12) already address these findings but **none have been merged**. No new PRs were opened in this run; no Issues were opened because **Issues are disabled in this repository**.

## Summary
- Total findings: 5 (unchanged)
- Critical: 1 | High: 1 | Medium: 2 | Low: 1
- PRs opened this run: 0 (existing PRs already cover every finding)
- Issues opened this run: 0 (Issues feature disabled on this repo)

## Existing Pull Requests (all open, awaiting merge)
- **CRITICAL / hardcoded password:** PRs #1, #3, #4, #7, #11, #12
- **HIGH / XSS via innerHTML:** PRs #5, #9
- **MEDIUM / missing security headers:** PRs #3, #5, #8
- **MEDIUM / no rate limiting:** PRs #3, #8
- **HIGH / path traversal in shell script:** PR #6
- **HIGH / SSRF in proxy endpoint:** PR #2
- **HIGH / GitHub Pages exposes repo root:** PR #10

## Findings

### [CRITICAL] Hardcoded password fallback in server.js
- **File:** `server.js` (line 8)
- **Status on main:** STILL PRESENT — `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
- **Description:** The `PASSWORD` constant uses a hardcoded fallback `certificationitq1!` when `APP_PASSWORD` is unset. Public source = anyone can authenticate.
- **Remediation:** Remove the fallback; require the env var; exit if missing.
- **PR-ready:** yes
- **Action taken:** No new PR — existing PRs #1, #3, #4, #7, #11, #12 already fix this. Merge one.

### [HIGH] XSS risk via innerHTML with untrusted external data
- **File:** `script.js` (`createBadgeCard()`, `createCommonCard()`, `renderByCertification()`)
- **Description:** Multiple `innerHTML` assignments interpolate badge data from the Credly API without sanitization.
- **Remediation:** Replace with `textContent` / `createElement()`, or apply DOMPurify / an `escapeHtml()` helper.
- **PR-ready:** yes
- **Action taken:** No new PR — existing PRs #5, #9 already fix this. Merge one.

### [MEDIUM] Missing security headers on Express server
- **File:** `server.js`
- **Description:** No `helmet` middleware; no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
- **Remediation:** Add `helmet` and apply as middleware.
- **PR-ready:** yes
- **Action taken:** No new PR — existing PRs #3, #5, #8 already cover this.

### [MEDIUM] No rate limiting on API endpoints
- **File:** `server.js`
- **Description:** Password endpoints brute-forceable; proxy endpoints abusable for DoS.
- **Remediation:** Add `express-rate-limit` on `/auth` and `/api/credly`.
- **PR-ready:** yes
- **Action taken:** No new PR — existing PRs #3, #8 provide partial coverage.

### [LOW] No HTTPS enforcement in server or nginx config
- **File:** `server.js`
- **Description:** Plain HTTP exposes the password in transit.
- **Remediation:** Deploy behind a TLS-terminating reverse proxy (Caddy, nginx, or hosting platform TLS).
- **PR-ready:** no (deployment concern)
- **Action taken:** Documented only; no PR/Issue (Issues disabled).

## Also checked (clean)
- No `eval`/`exec`/`pickle`/unsafe deserialization
- No SQL or command injection sinks (app uses in-memory JSON store)
- No hardcoded API keys or tokens beyond the documented `APP_PASSWORD` fallback
- `.github/workflows/pages.yml` pinning addressed in PR #10

## Recommendation

**Priority is to review and merge existing PRs, not open more.** The accumulation of 12 unmerged security PRs represents review fatigue. Suggested order:
1. Merge PR #12 (most recent CRITICAL fix) — resolves the hardcoded-password finding.
2. Merge PR #9 (most recent XSS + headers + SRI) — resolves HIGH/MEDIUM frontend issues.
3. Merge PR #8 or PR #10 for the GitHub Pages + static-serving hardening.
4. Close the remaining duplicate PRs once equivalents are merged.

If Issues are wanted as a tracking mechanism for the LOW (HTTPS) and MEDIUM (rate limiting) items, Issues will need to be re-enabled in repository settings first.
