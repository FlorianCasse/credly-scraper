# Security Review: credly-scraper

**Date:** 2026-06-03
**Branch:** `claude/intelligent-johnson-7EBBN`
**Reviewer:** Claude (claude-opus-4-7)

## Summary
- Total findings: 7
- Critical: 0 | High: 1 | Medium: 4 | Low: 2
- PRs opened: 1 — https://github.com/FlorianCasse/credly-scraper/pull/39
- Issues opened: 0 (GitHub Issues is disabled in this repository — LOW finding documented inline below)
- Scope checked: `server.js`, `script.js`, `index.html`, `package.json`, `package-lock.json` (via `npm audit`), `credly_badge_downloader.sh`, `.env.example`, `.gitignore`, `data/custom-profiles.json`, git history for committed secrets.

Headline findings: the previously hardcoded password fallbacks have been removed (commit `308b3f6`), so the prior CRITICAL is resolved. The remaining issues are XSS via `innerHTML` interpolation in `script.js`, a conditional SSRF via `next_page_url`, missing security headers, no brute-force protection on the Basic Auth gate, an over-broad static-file mount, missing username validation on upstream URL construction, and the listener binding to `0.0.0.0`. PR-ready findings are fixed in this branch.

## Findings

### [HIGH] XSS via innerHTML interpolation in script.js
- **File:** `script.js` (lines 395-407 `createBadgeCard`, 487-505 `createCommonCard`, 534-545 `renderByCertification`, 1262-1267 `initQuickSelect`)
- **Description:** Several functions assemble DOM via template-literal `innerHTML =` and interpolate values that ultimately come from untrusted sources: badge name and image URL from the Credly API (`badge.badge_template.name`, `badge.image_url`), issuer name, holder display names (Credly API), and country names from `/api/profiles` (persisted by `POST /api/profiles`). Any of those fields can carry HTML/JS and would be rendered unescaped, allowing reflected/stored XSS that runs in the authenticated session and can exfiltrate the Basic Auth credential or the APP_PASSWORD if entered.
- **Remediation:** Replace innerHTML interpolation with `createElement` + `textContent`. For URLs used in event handlers, validate the scheme is `http(s):` before passing to `window.open`. Done in this branch.
- **PR-ready:** yes
- **Action taken:** PR #39 https://github.com/FlorianCasse/credly-scraper/pull/39

### [MEDIUM] Conditional SSRF via unvalidated upstream URLs
- **File:** `server.js` (`fetchUrl` line 276, `fetchAllBadges` line 305 following `data.metadata.next_page_url`)
- **Description:** The batch and SSE badge endpoints follow `data.metadata.next_page_url` from the upstream response without re-validating its hostname. The `/api/credly` proxy validates URLs against `ALLOWED_CREDLY_HOSTS`, but the internal `fetchUrl` did not. A malicious upstream JSON (or a future change to where upstream URLs come from) could redirect the server-side fetch to arbitrary HTTPS hosts. Username interpolation into URLs was also unsanitized, so an attacker-controlled username string could rewrite the request path.
- **Remediation:** Apply a hostname allowlist to every outbound HTTPS request, validate usernames against `^[a-zA-Z0-9._-]{1,100}$`, URL-encode before interpolation, and cap pagination depth to prevent infinite loops. Done in this branch.
- **PR-ready:** yes
- **Action taken:** PR #39 https://github.com/FlorianCasse/credly-scraper/pull/39

### [MEDIUM] No security headers on Express server
- **File:** `server.js` (whole file, no helmet)
- **Description:** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc. Any XSS that lands is fully exploitable in any browser; the site can be embedded in iframes for clickjacking.
- **Remediation:** Add `helmet` middleware with a CSP that limits scripts to `'self'` plus the cdnjs origin used for JSZip, denies framing, and ships HSTS. Done in this branch.
- **PR-ready:** yes
- **Action taken:** PR #39 https://github.com/FlorianCasse/credly-scraper/pull/39

### [MEDIUM] No rate limiting / brute-force protection
- **File:** `server.js` (Basic Auth middleware and `/api/profiles` mutations)
- **Description:** The site-wide Basic Auth gate is the only thing standing between the public internet and the dashboard, and there is no per-IP cap on failed logins. Same on `POST /api/profiles` and `DELETE /api/profiles`, which check `APP_PASSWORD` and can be brute-forced. The Credly proxy can also be abused for traffic amplification toward `images.credly.com`.
- **Remediation:** Add `express-rate-limit` with a global limiter, a failed-auth limiter (`skipSuccessfulRequests: true`) on the Basic Auth gate, and a stricter write limiter on profile mutations. Done in this branch.
- **PR-ready:** yes
- **Action taken:** PR #39 https://github.com/FlorianCasse/credly-scraper/pull/39

### [MEDIUM] Over-broad static file serving exposes repo contents
- **File:** `server.js` (previously `app.use(express.static(__dirname, ...))` at line 55)
- **Description:** Mounting `express.static` on the repo root served every file in the working directory to authenticated users: `server.js`, `package.json`, `package-lock.json`, `README.md`, `data/custom-profiles.json`, `.env.example`, `credly_badge_downloader.sh`, etc. While the source is also public on GitHub, this is unnecessary attack surface — and a future commit dropping a sensitive file into the repo root would expose it immediately. (Express dotfile default is `'ignore'`, so `.env` itself returns 404; the rest still leak.)
- **Remediation:** Replace with an explicit whitelist of the two assets actually loaded (`style.css`, `script.js`), and keep the explicit `GET /` route for `index.html`. Done in this branch.
- **PR-ready:** yes
- **Action taken:** PR #39 https://github.com/FlorianCasse/credly-scraper/pull/39

### [LOW] Server binds to all interfaces (0.0.0.0)
- **File:** `server.js` (line 460 `app.listen(PORT, ...)`)
- **Description:** `app.listen(PORT)` defaults to binding `0.0.0.0`. The README documents an nginx reverse proxy in front, but if the firewall rule on the host ever lapses, the Express server is directly reachable on the LAN/public IP. Defense-in-depth fix is to bind explicitly to `127.0.0.1`. Did not change in this branch because it would impact deployments that bind to a non-loopback interface intentionally (e.g. in a container); reported as an Issue for review.
- **Remediation:** Either `app.listen(PORT, '127.0.0.1', ...)` and make the host configurable via env var, or document the expectation that the OS-level firewall blocks the port externally. Add the env var `BIND_HOST` (default `127.0.0.1`) as the safest path.
- **PR-ready:** no (deployment-dependent decision)
- **Action taken:** N/A — GitHub Issues is disabled in this repository. Tracked in this report; create a follow-up PR once the deployment topology is confirmed.

### [LOW] Generic Basic Auth error message and missing X-Robots-Tag
- **File:** `server.js` (auth middleware) — handled by helmet additions
- **Description:** The 401 response body `Authentication required.` is fine; no information leak. However, the page was not previously sending `X-Robots-Tag: noindex` (the site is private and shouldn't appear in any cache or crawler). Helmet's default headers plus an explicit `X-Robots-Tag` would harden this. Mostly addressed by the helmet additions in this branch; explicit `X-Robots-Tag` left for a follow-up.
- **Remediation:** Optionally add `res.set('X-Robots-Tag', 'noindex, nofollow, noarchive')` for every response.
- **PR-ready:** no (cosmetic, low impact)
- **Action taken:** N/A

## What was checked
- Hardcoded secrets / credentials in `server.js`, `script.js`, `package.json`, shell script — none remain (confirmed `308b3f6` removed the old fallbacks).
- Git history search (`git log --all -S 'certificationitq'`) — old hardcoded password still present in pre-`308b3f6` commits; cannot be removed without history rewrite, but the value has been rotated.
- `npm audit --json` — 0 vulnerabilities (express 4.22.2, no transitive CVEs).
- Insecure configurations: CORS, debug mode, exposed ports — bind to `0.0.0.0` flagged above.
- Injection vectors: command injection (none — no `exec`/`spawn` in `server.js`; the bash script does not eval untrusted input but uses `curl` with user-supplied URLs guarded by a regex), path traversal (none reachable through the API), template injection (none — no template engine), XSS (multiple, flagged above), SSRF (one conditional, flagged above).
- Use of `eval` / `new Function` / `document.write` — none.
- Authentication: site-wide Basic Auth with `crypto.timingSafeEqual`, plus a second `APP_PASSWORD` check for mutations. Both lack rate limiting (flagged above).
- File / directory permissions — N/A for the repo; deployment concern.
- Out of scope: nginx config, systemd unit, TLS termination — handled outside this repo per README.
