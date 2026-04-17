# Security Review: credly-scraper

**Date:** 2026-04-17 (re-run)
**Reviewer:** Claude (automated security review)
**Language/Framework:** Node.js / Express
**Dependency Manager:** npm (package.json)

## Status: Findings Persist on `main` — Multiple PRs Pending Merge

This re-run confirms that all previously identified findings remain present on `main`. Twelve PRs (#1, #3, #4, #5, #7, #8, #9, #10, #11, #12) already address these findings but **none have been merged**. No new PRs were opened in this run to avoid further duplication.

## Summary
- Total findings: 5 (unchanged)
- Critical: 1 | High: 1 | Medium: 2 | Low: 1
- PRs opened this run: 0 (existing PRs already cover all findings)
- Issues opened this run: 0 (Issues are disabled in this repository)

## Findings

### [CRITICAL] Hardcoded password fallback in server.js
- **File:** `server.js` (line 8)
- **Status on main:** STILL PRESENT — `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
- **Description:** The `PASSWORD` constant uses a hardcoded fallback `certificationitq1!` when `APP_PASSWORD` is unset. Public source = anyone can authenticate.
- **Remediation:** Remove the fallback; require the env var; exit if missing.
- **PR-ready:** yes
- **Existing PRs:** #1, #3, #4, #7, #11, #12 — pick one and merge

### [HIGH] XSS risk via innerHTML with untrusted external data
- **File:** `script.js` (`createBadgeCard()`, `createCommonCard()`, `renderByCertification()`)
- **Description:** Multiple `innerHTML` assignments interpolate badge data from the Credly API without sanitization.
- **Remediation:** Replace with `textContent` / `createElement()`, or apply DOMPurify.
- **PR-ready:** yes
- **Existing PRs:** #5, #9 — pick one and merge

### [MEDIUM] Missing security headers on Express server
- **File:** `server.js`
- **Description:** No `helmet` middleware; no CSP, HSTS, X-Frame-Options, etc.
- **Remediation:** Add `helmet` and apply as middleware.
- **PR-ready:** yes
- **Existing PRs:** #3, #5, #8 — pick one and merge

### [MEDIUM] No rate limiting on API endpoints
- **File:** `server.js`
- **Description:** Password endpoints brute-forceable; proxy endpoints abusable for DoS.
- **Remediation:** Add `express-rate-limit`.
- **PR-ready:** yes
- **Existing PRs:** #3, #8 — partial coverage

### [LOW] No HTTPS enforcement
- **File:** `server.js`
- **Description:** Plain HTTP exposes the password in transit.
- **Remediation:** Deploy behind a TLS-terminating reverse proxy.
- **PR-ready:** no (deployment concern)
- **Action:** Documented; no PR opened

## Recommendation

The priority is to **review and merge one of the existing PRs**, not to open more. The accumulation of 12 unmerged security PRs represents technical debt and review fatigue. Suggest closing duplicate PRs and merging PR #12 (most recent comprehensive fix for the CRITICAL finding) plus PR #5 or #9 for the XSS fix.
