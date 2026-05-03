# Security Review: credly-scraper

## Summary
- **Total findings:** 16
- **Critical:** 1 | **High:** 6 | **Medium:** 7 | **Low:** 2
- **PRs opened this run:** 0 (15 prior security PRs already cover every finding; opening more would compound review fatigue)
- **Issues opened this run:** 0 (the GitHub repository has Issues disabled — confirmed via `410 Issues has been disabled in this repository`)
- **Date:** 2026-05-03
- **Default branch:** `main` @ `9cef95f`
- **Stack:** Node.js / Express 4.21 (`package.json`), vanilla browser JS, Bash CLI script
- **Live site referenced:** https://credlyscraper.florian-casse.fr (deployed via systemd + Nginx; also published statically to GitHub Pages via `.github/workflows/deploy.yml`)

> ## Status: All findings persist on `main`. 15 unmerged security PRs already exist (#1-#15). No new PRs opened this run.

## Existing security PRs (all open, none merged)

| PR | Title | Findings covered |
|----|-------|------------------|
| #1 | fix: remove hardcoded default password | CRITICAL hardcoded password |
| #2 | fix: add SSRF protections to proxy endpoint | HIGH SSRF |
| #3 | fix: address critical security vulnerabilities | CRITICAL pwd, headers, rate limit, body size, SRI |
| #4 | security: remove hardcoded password fallback | CRITICAL hardcoded password |
| #5 | security: add security headers, SRI for CDN, and XSS sanitization | HIGH XSS, HIGH headers, LOW SRI |
| #6 | security: add username validation to prevent path traversal | HIGH path traversal in shell |
| #7 | Security: Remove hardcoded password and fix authentication | CRITICAL pwd, HIGH timing-safe, body size, bind 127 |
| #8 | Security: Harden server configuration and add protections | HIGH headers, HIGH static-expose, HIGH SSRF, MED rate limit, MED username validation |
| #9 | Security: Fix XSS vulnerabilities and add frontend protections | HIGH XSS, MED CSP, MED SRI, MED pwd-cache |
| #10 | Security: Fix GitHub Pages deployment and pin Actions | HIGH Pages exposure, MED Action pinning, LOW lockfile |
| #11 | fix: remove hardcoded credentials and add input validation | CRITICAL pwd, MED country length, LOW err leak, LOW username regex |
| #12 | fix: remove hardcoded password fallback [CRITICAL] | CRITICAL hardcoded password |
| #13 | security: remove hardcoded password fallback and add timing-safe compare | CRITICAL pwd, HIGH timing-safe |
| #14 | [CRITICAL] Security hardening: bundle | CRITICAL pwd, HIGH timing-safe, MED headers, MED rate limit, MED body cap, MED protocol check |
| #15 | security: remove hardcoded admin password fallback | CRITICAL hardcoded password |

## Findings

### [CRITICAL] Hardcoded admin password fallback in server.js
- **File:** `server.js` (line 8)
- **Description:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`. Because the repository is public, the fallback `certificationitq1!` is a working credential against any deployment that forgot to set `APP_PASSWORD`. The `POST /api/profiles` and `DELETE /api/profiles` mutation endpoints accept it directly via the JSON body. Confirmed still present on `main`.
- **Remediation:** Remove the fallback; require `APP_PASSWORD` (>= 12 chars); exit fatally if unset. Rotate the existing password. Consider a server-issued session cookie so the password is not replayed in every mutation request.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #1, #4, #7, #11, #12, #13, #14, #15. Recommend merging #14 (most comprehensive) or #15 (most recent focused fix).

### [HIGH] Stored XSS via innerHTML with untrusted external + user-supplied data
- **File:** `script.js` — `createBadgeCard()`, `createCommonCard()`, `renderByCertification()`, `initQuickSelect()`, custom-profile tag rendering, holders list rendering
- **Description:** Multiple template literals interpolate values into `innerHTML` without escaping. Attack surface includes:
  - Badge `name` / `badge_template.name` / `badge_template.issuer_org_name` from the Credly API.
  - Holder usernames rendered as `holder-tag` spans in the Common Certifications view.
  - **Custom country names** (free-text user input persisted server-side via `POST /api/profiles` with `country` from `req.body`) — second-user XSS: any visitor can poison the global custom-profiles list and execute JS in every other visitor's browser.
- **Remediation:** Add an `escapeHtml()` helper or rebuild affected nodes with `createElement` + `textContent`. Add a CSP via `helmet`.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #5, #9. PR #14 lists this as a deferred follow-up.

### [HIGH] GitHub Pages workflow publishes the entire repository root
- **File:** `.github/workflows/deploy.yml` (line 28: `path: '.'`)
- **Description:** `actions/upload-pages-artifact@v3` uploads the whole repo, so `server.js` (with the hardcoded password fallback string), `package.json`, the `data/` directory containing `custom-profiles.json`, `credly_badge_downloader.sh`, and the `.github/` workflow itself are all served from `https://florian-casse.github.io/credly-scraper/`. Anyone can fetch them at known paths even if the source repo were later made private.
- **Remediation:** Stage only the public-frontend files (`index.html`, `style.css`, `script.js`) into a build directory and set `path:` to that directory. Note: GitHub Pages serves only static files, so `server.js` doesn't *execute* there, but its content is publicly readable.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PR #10.

### [HIGH] GitHub Actions pinned by mutable tags
- **File:** `.github/workflows/deploy.yml` (lines 22, 25, 28, 33)
- **Description:** Every `uses:` reference is a floating tag (`@v4`, `@v3`). A compromised tag-overwrite can run arbitrary code with `pages: write` and `id-token: write` permissions in this repo.
- **Remediation:** Pin each action to a full 40-char commit SHA and add a renovate/dependabot config to bump them.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PR #10.

### [HIGH] Path traversal in shell script (credly_badge_downloader.sh)
- **File:** `credly_badge_downloader.sh` (`extract_username` at line ~73, then used as a directory component at line ~218 `local output_dir="credly_badges_${username}_$(date +%Y%m%d_%H%M%S)"`)
- **Description:** The regex `credly\.com/users/([^/]+)` accepts `..` and shell-special characters. A crafted argument like `https://www.credly.com/users/..%2F..%2Fetc` (or simpler unescaped variants) could escape the intended output directory. Subsequent `mkdir -p`, `mv`, and `tesseract` calls then operate on attacker-controlled paths.
- **Remediation:** Validate the extracted username against `^[A-Za-z0-9._-]+$` and reject otherwise.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PR #6.

### [HIGH] Plaintext, non-constant-time password comparison
- **File:** `server.js` (lines ~250 and ~276 in `POST /api/profiles` and `DELETE /api/profiles`)
- **Description:** `if (password !== PASSWORD)` is short-circuited and reveals timing information. Combined with the fact that the password is replayed in every mutation request body, this is exploitable across a network.
- **Remediation:** Use `crypto.timingSafeEqual` over equal-length buffers (e.g. SHA-256 hashes of both sides).
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #7, #13, #14.

### [HIGH] SSRF mitigations on /api/credly proxy are incomplete
- **File:** `server.js` (lines ~83-117)
- **Description:** Host allowlist is good, but: (1) protocol is not explicitly checked (`new URL('javascript:...')` would parse and pass an allowlisted host check if the attacker stuffed one in), (2) the endpoint is unauthenticated, (3) unbounded — a single client can replay it to fan out arbitrary requests through the server's egress identity, (4) cache key is the full URL with no normalization, allowing cache key flooding.
- **Remediation:** Require `parsed.protocol === 'https:'`; rate-limit per IP; cap the cache by entry count, not just bytes; verify `Content-Type` from upstream is image/* or application/json before caching.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #2, #8, #14.

### [MEDIUM] Missing security headers (helmet / CSP / HSTS / X-Frame-Options)
- **File:** `server.js`
- **Description:** No `helmet` middleware. Without CSP, the XSS finding above is unmitigated; without HSTS the password leak below is exacerbated; without `X-Frame-Options` / `frame-ancestors`, the app is clickjackable.
- **Remediation:** `app.use(helmet({ contentSecurityPolicy: { directives: { ... } } }))` with a tight CSP that only permits `cdnjs.cloudflare.com` (jszip) and `images.credly.com`. Better still, self-host jszip and tighten `script-src` to `'self'`.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #3, #5, #8, #14.

### [MEDIUM] No rate limiting on any endpoint
- **File:** `server.js`
- **Description:** `POST /api/profiles` is brute-forceable for the admin password. `/api/credly`, `/api/batch-badges`, and `/api/batch-badges-stream` are abusable for outbound fan-out DoS — each SSE request fans 10 concurrent upstream connections, and there is no per-IP cap on the number of streams.
- **Remediation:** `express-rate-limit` per route family — strict on auth (e.g. 10 / 15 min), looser but still capped on proxy/batch endpoints.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #3, #8, #14.

### [MEDIUM] Static file serving exposes project root
- **File:** `server.js` (line 12: `app.use(express.static(__dirname, ...))`)
- **Description:** The whole working directory is mounted. `GET /server.js`, `GET /package.json`, `GET /data/custom-profiles.json`, `GET /credly_badge_downloader.sh` are all reachable. This trivially leaks the hardcoded password (see CRITICAL) and the persisted profiles file.
- **Remediation:** Move public assets (`index.html`, `style.css`, `script.js`) to a `public/` directory and `express.static('public')` instead.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PR #8.

### [MEDIUM] No JSON request body size limit
- **File:** `server.js` (line 11: `app.use(express.json())`)
- **Description:** Express defaults to 100KB, but `POST /api/profiles` should be capped tighter and `DELETE /api/profiles` likewise. Useful as a defense-in-depth control against memory pressure.
- **Remediation:** `app.use(express.json({ limit: '16kb' }))`.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #7, #14.

### [MEDIUM] Third-party CDN script without Subresource Integrity
- **File:** `index.html` (line 117)
- **Description:** `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>` lacks `integrity=` and `crossorigin=`. A CDN compromise can inject arbitrary JS into every visitor.
- **Remediation:** Add `integrity="sha512-..."` and `crossorigin="anonymous"`. Better: self-host jszip from `node_modules` so CSP `script-src` can collapse to `'self'`.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #3, #5, #9.

### [MEDIUM] Username values not validated before upstream URL construction
- **File:** `server.js` (`/api/batch-badges` and `/api/batch-badges-stream`)
- **Description:** `usernames` array entries are interpolated into `https://www.credly.com/users/${username}/badges.json` with no validation. While the SSRF allowlist limits damage, an attacker can still inject path segments / query strings to confuse the upstream and the cache.
- **Remediation:** Validate each entry against `^[a-zA-Z0-9._-]{1,100}$`.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PRs #8, #11.

### [MEDIUM] Cache poisoning via unvalidated upstream Content-Type
- **File:** `server.js` (`/api/credly` proxy)
- **Description:** The proxy stores whatever `Content-Type` the upstream returns and serves it back, with TTL keyed on whether it starts with `image/`. A compromised upstream (or open-redirect chain) could store a long-TTL `text/html` response cached as an "image" path.
- **Remediation:** Reject upstream responses whose Content-Type isn't in an allowlist (`image/png`, `image/jpeg`, `image/svg+xml`, `application/json`, `text/json`). Cap cache entry size to, say, 5MB.
- **PR-ready:** yes
- **Action taken:** No new PR — already covered by PR #8.

### [LOW] No package-lock.json committed (supply-chain pinning)
- **File:** `package.json`
- **Description:** `"express": "^4.21.0"` with no lockfile means `npm install` fetches whatever fits the range at install time. Reproducibility and supply-chain integrity both suffer.
- **Remediation:** Commit `package-lock.json`, use `npm ci` in CI/deploy, enable Dependabot.
- **PR-ready:** yes (mechanical)
- **Action taken:** No new PR — flagged in PR #10.

### [LOW] Application does not enforce HTTPS
- **File:** `server.js`
- **Description:** The Express app listens on plain HTTP. The deployment is reportedly behind Nginx with TLS, but the app itself does not redirect / refuse plain-HTTP. If anyone exposes it directly, the admin password is sent in cleartext on every mutation.
- **Remediation:** Bind to `127.0.0.1` by default, document the TLS-terminating reverse proxy as required, or add a `trust proxy` + 308 redirect for non-HTTPS.
- **PR-ready:** no — deployment/architecture concern.
- **Action taken:** Documented; partial mitigation in PR #7 (`127.0.0.1` bind).

## Recommendation

Stop opening new PRs against this finding set. Triage and merge a small, non-overlapping subset:

1. **Merge PR #14** — addresses CRITICAL password, HIGH timing-safe compare, MEDIUM headers / rate-limit / body cap / protocol check in one commit.
2. **Merge PR #10** — fixes the GitHub Pages exposure and Action SHA pinning.
3. **Merge PR #6** — fixes the shell-script path traversal.
4. **Merge PR #9** — covers the XSS findings.

Then **close PRs #1, #2, #3, #4, #5, #7, #8, #11, #12, #13, #15 as superseded**. The accumulation of 15 overlapping security PRs is itself a security risk — review fatigue masks the few that need to be merged urgently.

Once those four are merged, **rotate the `APP_PASSWORD`** (the previous one is in git history) and add Dependabot / a `package-lock.json`.

## Errors during this run
- `mcp__github__run_secret_scanning` returned `Repository does not have GitHub Advanced Security enabled` — could not run the secret scanner. Manual inspection confirmed the only embedded credential is the hardcoded `APP_PASSWORD` fallback (already covered above).
- `mcp__github__issue_write (create)` returned `410 Issues has been disabled in this repository` — could not file a tracking issue. All findings recorded in this report instead.
