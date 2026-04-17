# Security Review: credly-scraper

**Date:** 2026-04-17 (re-run)
**Reviewer:** Claude (automated security review)
**Default branch reviewed:** `main` @ `9cef95f`
**Language / Framework:** Node.js / Express 4.x (plus bash + static HTML/CSS/JS)
**Dependency manager:** npm (`package.json`) — no lockfile present

## Status: findings persist on `main`; 12 unmerged security PRs pending

This re-run confirms that every previously identified finding is still present on `main`. Twelve open security PRs (#1–#12) already cover these findings but **none have been merged**. To avoid further PR accumulation, this run opened **no new fix PRs** and instead maps each finding to an existing PR. Issues are disabled on this repo, so the tracking summary below is recorded in this report rather than on the issue tracker.

## Summary
- Total findings: 18
- CRITICAL: 1 | HIGH: 6 | MEDIUM: 7 | LOW: 4
- PRs opened in this run: **0** (all findings already covered by existing PRs #1–#12)
- Issues opened in this run: **0** — Issues are disabled on this repository (GitHub API returned `410 Issues has been disabled`).
- `Claude` label: confirmed present (`get_label` succeeded).

## Scope Reviewed
Files and paths read:
- `/` (root directory listing)
- `package.json` (dependency manifest; single dep `express ^4.21.0`)
- `server.js` (Express backend — proxy, profile API, cache, batch, SSE)
- `script.js` (frontend scraper / DOM rendering)
- `index.html` (static UI, JSZip CDN)
- `.gitignore`
- `credly_badge_downloader.sh` (macOS shell tool)
- `README.md`
- `.github/workflows/deploy.yml` (GitHub Pages deploy)
- `security-review-credly-scraper.md` (prior report)

Dependency manifest inspected: `package.json` (no `package-lock.json`, no `requirements.txt`, no `go.mod`, no other manifest files).

## Findings

### [CRITICAL] Hardcoded password fallback in server.js
- **File:** `server.js` (line 8)
- **Evidence:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
- **Description:** Anyone reading the public source can authenticate to the password-protected `POST /api/profiles` and `DELETE /api/profiles` endpoints if the operator forgets to set `APP_PASSWORD`.
- **Remediation:** Require `APP_PASSWORD`; exit immediately when missing. Rotate the leaked value (`certificationitq1!`) on all deployments that ever ran with the default.
- **PR-ready:** yes
- **Action taken:** Existing PRs: #1, #3, #4, #7, #11, #12. Recommend merging **#12** (focused) or **#11** (bundles country-length + SSE error sanitization).

### [HIGH] XSS via innerHTML with untrusted external data
- **File:** `script.js` in `createBadgeCard()` (≈ line 239), `createCommonCard()` (≈ line 345), `renderByCertification()` (≈ line 400), custom-profile tag rendering in `initQuickSelect()` (≈ line 690), and the profile error path in `handleFetchBadges()`.
- **Description:** Badge names, issuer names, usernames, and custom-profile country strings come from the Credly API and user-submitted data, then get written via `innerHTML`. A malicious badge name or country string can execute arbitrary JS.
- **Remediation:** Replace `innerHTML` interpolations with `textContent` / `createElement` / `append`, or add an `escapeHtml` helper and wrap every interpolation; additionally add a `Content-Security-Policy` meta tag.
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#5**, **#9**.

### [HIGH] Open proxy / SSRF hardening gaps in /api/credly
- **File:** `server.js` (`ALLOWED_CREDLY_HOSTS` check, ≈ lines 84–95)
- **Description:** The hostname allow-list is present, but: (a) the URL scheme is not restricted to HTTPS, so `http://www.credly.com/...` is accepted and data flows in plaintext; (b) URLs containing embedded credentials (`https://user:pass@credly.com/...`) are not rejected; (c) the endpoint is unauthenticated and unthrottled — anyone can proxy arbitrary credly.com URLs through the server, amplifying their IP.
- **Remediation:** Enforce `parsed.protocol === 'https:'`, reject URLs whose `username`/`password` are non-empty, and add rate limiting. Optionally restrict query paths to `/users/...` and `/badges/...`.
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#2**, **#8**.

### [HIGH] Static file serving exposes server source and data
- **File:** `server.js` (line 12): `app.use(express.static(__dirname, { index: false, extensions: ['html', 'css', 'js'] }));`
- **Description:** `__dirname` is the project root, so `server.js`, `package.json`, `credly_badge_downloader.sh`, `data/custom-profiles.json` (and anything else added later) are all served publicly. With the `extensions: [... 'js']` fallback, even extensionless paths like `/server` may resolve to `server.js`.
- **Remediation:** Move static assets (`index.html`, `script.js`, `style.css`) into a `public/` subdirectory and point `express.static` at that. Keep server code and data outside the static root.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#8**.

### [HIGH] GitHub Pages workflow uploads entire repo root
- **File:** `.github/workflows/deploy.yml` (step "Upload artifact", `path: '.'`)
- **Description:** The deploy workflow uploads the whole repo to GitHub Pages. That means `server.js` (with the hardcoded password fallback), `package.json`, and anything in `data/` become publicly downloadable from the Pages URL. This amplifies the CRITICAL secret leak and exposes non-public code paths.
- **Remediation:** Restrict the uploaded artifact to only the static frontend files (`index.html`, `style.css`, `script.js`) via a staging step that copies whitelisted files into a `_site/` directory.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#10**.

### [HIGH] Path traversal in shell script (username -> filesystem path)
- **File:** `credly_badge_downloader.sh` — `extract_username()` (line ~75) and downstream `mkdir`/`mv` calls in `main()` (lines ~210+).
- **Description:** The regex `credly\.com/users/([^/]+)` accepts a username like `..` or `..%2F..` which then flows into `credly_badges_${username}_...` and into `$output_dir/raw/...` paths. A crafted URL can cause files to be written outside the intended output directory.
- **Remediation:** After extraction, validate with `[[ $username =~ ^[A-Za-z0-9._-]{1,100}$ ]]` and fail otherwise.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#6**.

### [HIGH] Timing-unsafe password comparison
- **File:** `server.js` — `POST /api/profiles` and `DELETE /api/profiles` (`if (password !== PASSWORD)` ≈ lines 245, 280).
- **Description:** Direct string compare is timing-observable; combined with the lack of rate limiting and the presence of a hardcoded fallback, this makes brute-force / timing-guess attacks practical.
- **Remediation:** Compare with `crypto.timingSafeEqual` after length-normalizing both sides via `crypto.createHash('sha256').update(x).digest()`.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#7**.

### [MEDIUM] Missing security headers
- **File:** `server.js`
- **Description:** No `helmet` (or equivalent) — responses lack CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **Remediation:** `npm i helmet` and `app.use(helmet({ contentSecurityPolicy: {...} }))`.
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#3**, **#5**, **#8**.

### [MEDIUM] No rate limiting on any endpoint
- **File:** `server.js`
- **Description:** `POST/DELETE /api/profiles` can be brute-forced (password guessing); `/api/credly` and `/api/batch-badges*` can be abused to run arbitrary upstream requests/DOS Credly on behalf of the server operator.
- **Remediation:** `npm i express-rate-limit`; apply strict limits to `/api/profiles` (e.g. 5/min per IP) and moderate limits to proxy/batch endpoints.
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#3**, **#8**.

### [MEDIUM] No JSON body size limit
- **File:** `server.js` — `app.use(express.json());`
- **Description:** Default body limit is 100 KB which is generous for this API; more importantly, setting an explicit small limit (e.g. `{ limit: '16kb' }`) makes the intent clear and reduces exposure if defaults change.
- **Remediation:** `app.use(express.json({ limit: '16kb' }));`
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#3**, **#7**.

### [MEDIUM] Username input not validated in batch endpoints
- **File:** `server.js` — `POST /api/batch-badges` (≈ line 180), `GET /api/batch-badges-stream` (≈ line 215), and helpers `fetchAllBadges`, `fetchDisplayName`.
- **Description:** Submitted `usernames` flow directly into `https://www.credly.com/users/${username}/badges.json`. Although the hostname is fixed, odd values (e.g. `..`, `foo/bar`, URL-encoded slashes, query-string smuggling) could alter the upstream path. Validation should be explicit.
- **Remediation:** Enforce `/^[A-Za-z0-9._-]{1,100}$/` on each username and reject the whole batch if any fail.
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#8**, **#11**.

### [MEDIUM] GitHub Actions pinned by mutable tag
- **File:** `.github/workflows/deploy.yml`
- **Description:** `actions/checkout@v4`, `actions/configure-pages@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4` — all pinned by mutable tags. A compromised tag republication can run arbitrary code with `id-token: write` and `pages: write`.
- **Remediation:** Pin each action to a full commit SHA and add a renovation policy.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#10**.

### [MEDIUM] No package-lock.json committed
- **File:** `package.json` / repo root
- **Description:** Without a lockfile, `npm install` resolves `express ^4.21.0` to whatever version is current at install time — non-reproducible and supply-chain exposed.
- **Remediation:** Commit a `package-lock.json` (or `pnpm-lock.yaml` / `yarn.lock`) and use `npm ci` in deployment.
- **PR-ready:** yes (but requires running `npm install` to generate the lockfile — not done here)
- **Action taken:** Existing PR: **#10**.

### [MEDIUM] Cache poisoning via trusted upstream content-type
- **File:** `server.js` — `setCache` (≈ line 54) stores whatever `Content-Type` the upstream returned and serves it back on cache hits.
- **Description:** If Credly (or a MITM) ever returns a weird content-type (e.g. `text/html` with embedded JS), the proxy will faithfully serve that to the browser under the same origin. Combined with the `express.static` root exposure, this widens XSS and click-jacking surfaces.
- **Remediation:** Validate content-type against an allow-list (`application/json`, `image/*`) and coerce to `application/octet-stream` or drop otherwise.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#8**.

### [LOW] JSZip loaded without SRI / crossorigin
- **File:** `index.html` (last `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js">`)
- **Description:** A CDN compromise or tag-name re-publication could ship attacker-controlled code directly into the site.
- **Remediation:** Add `integrity="sha384-..."` and `crossorigin="anonymous"` attributes (or self-host the file).
- **PR-ready:** yes
- **Action taken:** Existing PRs: **#3**, **#5**, **#9**.

### [LOW] Server binds 0.0.0.0 by default
- **File:** `server.js` — `app.listen(PORT, ...)` (last line)
- **Description:** When fronted by a reverse proxy on the same host, the Node process should bind to `127.0.0.1` so it is not reachable directly on the public interface.
- **Remediation:** `app.listen(PORT, process.env.BIND_ADDR || '127.0.0.1', ...)`.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#7**.

### [LOW] Raw error messages leak to SSE stream
- **File:** `server.js` — `GET /api/batch-badges-stream` (≈ line 233) writes `err.message` to the SSE `data:` line.
- **Description:** Upstream error details (`HTTP 500: upstream says ...`) propagate verbatim to the browser. Low risk but prefer a generic message and log details server-side.
- **Remediation:** Replace with `"Failed to fetch profile"` and `console.error` the real message server-side.
- **PR-ready:** yes
- **Action taken:** Existing PR: **#11**.

### [LOW] No HTTPS enforcement at the Node layer
- **File:** `server.js`
- **Description:** The server speaks plain HTTP and relies entirely on the operator to terminate TLS at a reverse proxy. If ever deployed without that, passwords go over the wire in cleartext.
- **Remediation:** Document the deployment requirement prominently in `README.md` and (optionally) reject requests lacking `X-Forwarded-Proto: https` via middleware when `NODE_ENV=production`.
- **PR-ready:** no (deployment concern)
- **Action taken:** Documented; no PR opened.

## Labeling & process notes
- The `Claude` label exists (id `LA_kwDORUkrfs8AAAACdu8eCQ`) and is already applied to existing PRs where appropriate.
- Issues are disabled on this repository. Attempting `POST /repos/.../issues` returns `410 Issues has been disabled`. No issue was opened for the tracking note; this report stands in its place.
- No new PRs were opened in this run. Every finding above is already covered by at least one of the twelve open PRs (#1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12).

## Recommendation

1. Pick **one** CRITICAL fix PR and merge it: recommend **#12** (focused, most recent). Close the other four duplicates (#1, #4, #7, #11, #3 for this finding).
2. Pick **one** XSS fix PR and merge it: recommend **#9** (bundles CSP meta tag + SRI). Close **#5**.
3. Merge **#8** for the static-root / SSRF / rate-limit / content-type bundle, then merge **#3** for helmet + express-rate-limit + body size.
4. Merge **#10** (Pages artifact scope + Actions SHA pinning).
5. Merge **#6** (shell-script username validation).
6. Merge **#2** (HTTPS-only + credential-URL rejection) _if not already superseded by #8_.
7. Generate and commit `package-lock.json`, then switch deployment to `npm ci`.
8. After merges, rotate `APP_PASSWORD` on every live deployment.

The priority is **review and merge**, not more PRs.
