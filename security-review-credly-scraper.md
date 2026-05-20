# Security Review: credly-scraper

_Last review: 2026-05-20_

## Summary
- Total findings: 8
- Critical: 1 | High: 1 | Medium: 4 | Low: 2
- PRs opened: 1 (consolidated on `claude/intelligent-johnson-TSC54`)
- Issues opened: 0 (all findings are PR-ready and bundled in the consolidated PR)

> Note: this repository has many open PRs from prior security review runs that
> were never merged. This run consolidates all fixes onto the assigned branch
> per the task's branch policy.

## Findings

### [CRITICAL] Hardcoded default password in server.js
- **File:** `server.js` (line 8)
- **Description:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';` ships a real, working admin password in the public source tree. Anyone with read access to the repository can authenticate to `POST` / `DELETE /api/profiles` on any deployment that has not overridden `APP_PASSWORD`.
- **Remediation:** Require `APP_PASSWORD` from the environment, refuse to start without it (>= 12 chars), and compare candidates with `crypto.timingSafeEqual` over SHA-256 digests to eliminate the timing side channel.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [HIGH] XSS via innerHTML interpolation with untrusted Credly data
- **File:** `script.js` (`createBadgeCard`, `createCommonCard`, `renderByCertification`, `initQuickSelect`, custom-profile rendering)
- **Description:** Multiple `innerHTML` assignments interpolate `badge_template.name`, `issuer_org_name`, holder display names, and user-supplied country names directly into HTML. A compromised Credly API response, or any user-supplied country string with HTML in it, becomes script execution in any other viewer's browser (stored XSS for the custom-profiles store).
- **Remediation:** Replace every `innerHTML` assignment in the affected functions with `createElement` + `textContent`. Open the original badge image via a closure-captured `window.open(url, '_blank', 'noopener,noreferrer')` rather than embedding it in a `data-url` attribute.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [MEDIUM] Missing security headers (no helmet)
- **File:** `server.js` (top-of-file setup)
- **Description:** No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or HSTS are emitted. Clickjacking, MIME sniffing, and reflected-XSS protections are absent.
- **Remediation:** Mount `helmet()` with a CSP that allows only the cdnjs origin used by `index.html` and `data:`/`blob:` images required by the badge canvas. Disable `x-powered-by`.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [MEDIUM] No rate limiting on auth and proxy endpoints
- **File:** `server.js` (`POST/DELETE /api/profiles`, `/api/credly`, `/api/batch-badges`, `/api/batch-badges-stream`)
- **Description:** Auth endpoints are brute-forceable; proxy endpoints can be abused as a free Credly egress relay or to exhaust bandwidth.
- **Remediation:** Mount `express-rate-limit`: a strict policy (20 req / 15 min) on write endpoints and a looser one (120 req / min) on the Credly proxy / batch endpoints. Configure `trust proxy` so the limiter sees the real client IP behind a single reverse-proxy hop.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [MEDIUM] `express.static(__dirname)` exposes the entire repository root
- **File:** `server.js` (line 12)
- **Description:** Serving `__dirname` with extension whitelisting still serves `server.js`, `package.json`, `data/custom-profiles.json` (the user list), and `credly_badge_downloader.sh` when requested by exact path. Any file added at the root will become reachable.
- **Remediation:** Drop `express.static` and add explicit `app.get` handlers for the closed set of public files (`/index.html`, `/script.js`, `/style.css`, `/`).
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [MEDIUM] No JSON body size limit
- **File:** `server.js` (line 11)
- **Description:** `express.json()` accepts the default 100 KB body. With no auth on most endpoints, an attacker can submit large payloads to exhaust memory. Cap the body well below the default for an API with very small payloads.
- **Remediation:** `app.use(express.json({ limit: '64kb' }))`.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [LOW] Unauthenticated cache statistics endpoint
- **File:** `server.js` (line 132)
- **Description:** `GET /api/cache-stats` returns the number of cached entries and current cache size to anonymous clients. Mostly reconnaissance value, but there is no reason to expose it.
- **Remediation:** Gate the endpoint behind the same `APP_PASSWORD` check as the write endpoints.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

### [LOW] No SSRF defence-in-depth on `/api/credly` URL protocol
- **File:** `server.js` (line 86)
- **Description:** The proxy already checks the hostname allowlist but does not explicitly require `https:`. A request like `?url=ftp://www.credly.com/...` would currently be host-accepted before any HTTP call is made.
- **Remediation:** Reject any parsed URL whose `protocol !== 'https:'` before continuing.
- **PR-ready:** yes
- **Action taken:** Fixed in consolidated PR on `claude/intelligent-johnson-TSC54`.

## Verification Notes

The reviewer also independently re-verified the prior `security-review-credly-scraper.md` findings and confirmed each unfixed item against the actual source. Username validation (`/^[A-Za-z0-9._-]{1,64}$/`) was added in `safeUsername()` and applied in `fetchAllBadges`, `fetchDisplayName`, `POST /api/batch-badges`, and `GET /api/batch-badges-stream` as defence-in-depth before splicing usernames into upstream URLs.

Upstream error messages echoed back to clients (`err.message`) were replaced with a generic `"Fetch failed"` to avoid leaking internal stack frames or upstream details.
