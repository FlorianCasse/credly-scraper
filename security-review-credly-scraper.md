# Security Review: credly-scraper

_Reviewed: 2026-04-27 — Branch `claude/charming-mccarthy-JdCmo`_

Stack: Node.js / Express server (`server.js`), vanilla JS frontend (`script.js`,
`index.html`), bash helper (`credly_badge_downloader.sh`).
Dependency manager: npm (`package.json`).

## Summary
- Total findings: 8
- CRITICAL: 1 | HIGH: 2 | MEDIUM: 4 | LOW: 1
- PRs opened: 1 (bundled fix on the development branch — see "Action taken" rows)
- Issues opened: 4 (see "Action taken" rows)

## Findings

### [CRITICAL] Hardcoded admin password fallback in source
- **File:** `server.js` (line 8, pre-fix)
- **Description:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
  ships a real-looking default credential into a public repository. Anyone who
  reads the repo (or the build artefact) can add or delete custom Credly
  profiles on any deployment that forgot to set `APP_PASSWORD`.
- **Remediation:** Drop the fallback. Refuse to start when `APP_PASSWORD` is
  unset or shorter than a sane minimum, then compare candidates with
  `crypto.timingSafeEqual` over a fixed-size hash so request timing does not
  leak the secret.
- **PR-ready:** yes
- **Action taken:** Fix included in the bundled PR on
  `claude/charming-mccarthy-JdCmo`.

### [HIGH] Stored / reflected XSS via `innerHTML` with untrusted data
- **File:** `script.js` (multiple — `createBadgeCard`, `createCommonCard`,
  `renderByCertification`, `initQuickSelect`, custom-profile tag rendering)
- **Description:** Badge names, issuer names, holder usernames, custom country
  names, and custom Credly URLs are interpolated into template literals and
  assigned via `innerHTML` without HTML-escaping. Badge metadata comes from
  the upstream Credly API (which can include attacker-influenced strings if
  Credly ever serves manipulated content) and country names come straight from
  user input persisted on the server, so the second user to open the page
  executes whatever the first user typed.
- **Remediation:** Add an `escapeHtml(s)` helper and escape every interpolation
  used inside `innerHTML`, or rebuild the affected nodes with `createElement`
  + `textContent`. Tighten the CSP `script-src` (currently must allow the
  jszip CDN) once the SRI fix lands.
- **PR-ready:** yes (touches many DOM-build sites, opened as a tracked issue
  to allow careful UI verification per call site)
- **Action taken:** Issue opened (link below).

### [HIGH] Plaintext password compared with `!==`
- **File:** `server.js` (line ~289 / line ~313, pre-fix)
- **Description:** Both `POST /api/profiles` and `DELETE /api/profiles`
  authenticated with `password !== PASSWORD`. String compare is timing-leaky
  and there is no brute-force throttle on these endpoints.
- **Remediation:** Hash the candidate and compare with
  `crypto.timingSafeEqual`; gate the mutation endpoints behind
  `express-rate-limit`.
- **PR-ready:** yes
- **Action taken:** Fix included in the bundled PR on
  `claude/charming-mccarthy-JdCmo`.

### [MEDIUM] Missing security headers (no `helmet`)
- **File:** `server.js` (Express bootstrap)
- **Description:** No CSP, no `X-Content-Type-Options`, no
  `X-Frame-Options`/`frame-ancestors`, no `Referrer-Policy`. Combined with
  the XSS issue above this turns a small bug into a serious one.
- **Remediation:** Mount `helmet()` with a CSP that allows only the cdnjs
  origin used by jszip and the `images.credly.com` origin used for badges.
- **PR-ready:** yes
- **Action taken:** Fix included in the bundled PR on
  `claude/charming-mccarthy-JdCmo`.

### [MEDIUM] Proxy endpoint accepts arbitrary URL protocol
- **File:** `server.js` `/api/credly` (host allowlist only)
- **Description:** `new URL(req.query.url)` accepts `file:`, `gopher:`, etc.;
  although the actual fetch uses `https.get` (which would reject
  non-https URLs), the host check passes for `https://credly.com.evil.com`
  only via DNS rebinding edge cases — but more importantly, no explicit
  scheme check is documented. Defence in depth is cheap.
- **Remediation:** Reject any URL whose `protocol !== 'https:'`. Keep the
  existing strict host allowlist.
- **PR-ready:** yes
- **Action taken:** Fix included in the bundled PR on
  `claude/charming-mccarthy-JdCmo`.

### [MEDIUM] Third-party script loaded from CDN without Subresource Integrity
- **File:** `index.html` (line 117)
- **Description:** `<script src="https://cdnjs.cloudflare.com/.../jszip.min.js">`
  with no `integrity=` / `crossorigin=` attribute. A CDN compromise or MITM
  on a browser without HSTS-preload cache can swap in malicious JS that runs
  in the user's session.
- **Remediation:** Add `integrity="sha512-..."` and `crossorigin="anonymous"`
  to the script tag (cdnjs publishes the official SRI hash for jszip 3.10.1
  next to the download link), or self-host jszip from the project's static
  directory.
- **PR-ready:** yes (kept as an Issue because the SRI hash should be copied
  from cdnjs itself, not generated)
- **Action taken:** Issue opened (link below).

### [MEDIUM] Admin password sent in request body — relies on TLS at the edge
- **File:** `server.js` `/api/profiles` (POST + DELETE), `script.js`
- **Description:** The shared admin password is posted in the request body
  every time a profile is added or removed. Behind HTTP it leaks; behind a
  reverse proxy with HTTP→HTTPS redirect there is still a one-shot exposure
  window.
- **Remediation:** Document the requirement to terminate TLS in front of the
  app (or bind the listener to localhost only); ship a short-lived
  HttpOnly+Secure session cookie after the first successful auth so the
  password isn't replayed; redirect to HTTPS at the app level when behind a
  reverse proxy.
- **PR-ready:** no (operational/architecture decision)
- **Action taken:** Issue opened (link below).

### [LOW] No bound on concurrent SSE connections
- **File:** `server.js` `/api/batch-badges-stream`
- **Description:** Any client can open many concurrent
  `/api/batch-badges-stream?usernames=...` long-poll connections. Each one
  pins event-loop work fan-out. There is no global concurrency cap.
- **Remediation:** Add an in-process semaphore on active SSE streams (e.g.
  reject when more than N are open) and reuse `express-rate-limit` for the
  endpoint at a low rate.
- **PR-ready:** no
- **Action taken:** Issue opened (link below).

## What was checked

- `server.js` — auth, SSRF, headers, body-size, rate-limit, secrets
- `script.js` — DOM injection, URL handling, XSS sinks
- `index.html` — third-party scripts (CDN integrity, CSP)
- `package.json` — direct deps surface (Express only) + missing security deps
- `credly_badge_downloader.sh` — `set -e`, dependency checks, OCR/IM usage
  (no shell-injection sinks; uses `command -v` and quoted variables)
- `.gitignore` — secrets exposure (clean)

## Action links

PR and Issue URLs are written into the PR description and the corresponding
GitHub Issues created from this review.
