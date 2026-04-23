# Security Review: credly-scraper

**Date:** 2026-04-23 (re-run — session `KDaey`)
**Branch:** `claude/jolly-einstein-KDaey`
**Reviewer:** Claude (automated security review)
**Language/Framework:** Node.js / Express 4.21
**Dependency Manager:** npm (`package.json`) — no `package-lock.json` committed

## Summary
- Total findings: 6 (1 CRITICAL, 2 HIGH, 2 MEDIUM, 1 LOW — all previously identified)
- Critical: 1 | High: 2 | Medium: 2 | Low: 1
- PRs opened this run: 0
- Issues opened this run: 1 meta-tracking issue; Issues are disabled in this repo

## Context
GitHub Issues are **disabled** in this repository; all prior reviews have used Pull Requests as the finding tracker. There are currently **12 open unmerged `Claude`-labeled security PRs** (#1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12) covering every finding below — several are near-duplicates. Opening new PRs would compound technical debt. This run references the existing PRs under **Action taken** rather than producing fresh duplicates.

## Areas Reviewed
- Source: `server.js` (Express API + profile store + Credly proxy + SSE batch endpoint + cache pre-warm)
- Source: `script.js` (frontend rendering; untrusted badge data into `innerHTML`)
- Source: `credly_badge_downloader.sh` (standalone OCR pipeline)
- Frontend: `index.html` (CDN-loaded `jszip` without SRI)
- Config: `package.json` (no lockfile, Express pinned `^4.21.0`)
- CI/CD: `.github/workflows/*` (pages deploy path; action SHA pinning)

## Findings

### [CRITICAL] Hardcoded password fallback in `server.js`
- **File:** `server.js:9` — `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
- **Description:** Public repo; the fallback password authenticates profile add/remove in the API.
- **Remediation:** Remove the fallback; require the env var; exit on boot if missing.
- **PR-ready:** yes
- **Action taken:** Existing PRs **#1, #3, #4, #7, #11, #12** each implement this — pick the most recent (#12) and merge. No duplicate opened.

### [HIGH] Stored XSS via `innerHTML` in badge/common/certification renderers
- **File:** `script.js` (`createBadgeCard()`, `createCommonCard()`, `renderByCertification()`)
- **Description:** Unsanitized Credly API fields (name, issuer, country) interpolated into `innerHTML`. Country is also attacker-controllable via `/api/profiles`.
- **Remediation:** Add `escapeHtml()` helper (or replace with `textContent` / DOM APIs); add CSP.
- **PR-ready:** yes
- **Action taken:** Existing PRs **#5, #9** each implement this. No duplicate opened.

### [HIGH] Plaintext password comparison (timing side channel)
- **File:** `server.js` — POST/DELETE `/api/profiles` use `password !== PASSWORD`
- **Remediation:** `crypto.timingSafeEqual()` over Buffers of equal length; add rate limiter.
- **PR-ready:** yes
- **Action taken:** Existing PR **#7** implements this. No duplicate opened.

### [MEDIUM] Missing security headers (no `helmet`)
- **File:** `server.js`
- **Remediation:** Install and mount `helmet`; disable default CSP, configure explicit one.
- **PR-ready:** yes
- **Action taken:** Existing PRs **#3, #5, #8** each implement this. No duplicate opened.

### [MEDIUM] No rate limiting on API endpoints — password brute force and proxy DoS
- **File:** `server.js` — `/api/profiles`, `/api/credly`, `/api/batch-badges`, `/api/batch-badges-stream`
- **Remediation:** `express-rate-limit` with per-route buckets.
- **PR-ready:** yes
- **Action taken:** Existing PRs **#3, #8** implement this (partial). No duplicate opened.

### [MEDIUM] Missing SRI on `jszip` CDN script in `index.html`
- **File:** `index.html:117` — `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js">` (no `integrity`, no `crossorigin`)
- **Remediation:** Add `integrity="sha384-..."` + `crossorigin="anonymous"`, or self-host.
- **PR-ready:** yes
- **Action taken:** Existing PRs **#3, #5, #9** implement this. No duplicate opened.

### [MEDIUM] Open-proxy / SSRF surface via `/api/credly?url=`
- **File:** `server.js:80–110`
- **Description:** Allowed hosts are restricted to `credly.com`, but path/query are attacker-controlled and response is cached and relayed. A redirect from `credly.com` to an internal host is currently followed by `https.get` defaults (no redirect follow — actually mitigated here).
- **Remediation:** Enforce HTTPS, reject URLs with userinfo, restrict path prefix to `/users/` or `/badges/`, validate upstream content-type before caching.
- **PR-ready:** yes
- **Action taken:** Existing PRs **#2, #8** implement this. No duplicate opened.

### [LOW] Path-traversal in `credly_badge_downloader.sh` via crafted profile URL
- **File:** `credly_badge_downloader.sh:83` (regex `credly\.com/users/([^/]+)`)
- **Remediation:** Validate username against `^[a-zA-Z0-9._-]+$` after extraction.
- **PR-ready:** yes
- **Action taken:** Existing PR **#6** implements this. No duplicate opened.

### [LOW] GitHub Pages workflow deploys entire repo root, exposing `server.js`/`package.json`/`data/`
- **File:** `.github/workflows/*` (pages deploy step)
- **Action taken:** Existing PR **#10** implements this. No duplicate opened.

## Findings-per-area check
- Hardcoded secrets: **CRITICAL** (password fallback — #1/#12)
- Dependency vulns: `express ^4.21.0` only; no lockfile → non-reproducible installs.
- Insecure config: no `helmet` (#3/#5/#8); no rate limit (#3/#8); static serve of project root (#10).
- Injection risks: XSS (#5/#9); path-traversal in shell script (#6); SSRF (#2/#8).
- Insecure deserialization: `JSON.parse` on cached upstream bodies — `fetchUrl` validates status but not content-type before `JSON.parse` (minor, covered by #8 cache-poisoning fix).
- Security headers: absent (#3/#5/#8).
- File perms: `fs.writeFileSync` on `data/custom-profiles.json` — concurrent writes can corrupt; no finding tracked.

## Recommendation
1. **Close duplicate PRs and merge one comprehensive fix.** Suggested canonical set: **#12** (CRITICAL fallback) → **#7** (timing-safe compare + 127.0.0.1 bind) → **#5 or #9** (XSS + SRI) → **#8** (helmet + rate-limit + SSRF) → **#10** (pages deploy path) → **#6** (shell script).
2. **Enable Issues** so future findings aren't forced into PR form.
3. **Commit a `package-lock.json`** so `npm ci` is reproducible.
4. **Add a `SECURITY.md`** documenting accepted risk and a scan-exclude list so future automated runs don't keep re-opening these.

Generated by Claude on 2026-04-23.
