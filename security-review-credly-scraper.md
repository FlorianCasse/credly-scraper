# Security Review: credly-scraper

**Date:** 2026-04-29
**Reviewer:** Claude (automated security review)
**Default branch reviewed:** `main` @ `9cef95f9`
**Dev branch:** `claude/optimistic-ritchie-uoeGi`
**Language/Framework:** Node.js / Express 4
**Files in scope:** `server.js`, `script.js`, `index.html`, `credly_badge_downloader.sh`, `package.json`, `.gitignore`

## Summary

- Total findings: 10
- Critical: 1 | High: 3 | Medium: 4 | Low: 2
- PRs opened: pending (see Action taken per finding below)
- Issues opened: pending (see Action taken per finding below)

## Operational notes

- Repository **does not have GitHub Advanced Security** enabled, so the
  `mcp__github__run_secret_scanning` tool errored. Manual grep of
  `server.js`, `script.js`, `index.html`, `package.json`, `.gitignore`,
  and `credly_badge_downloader.sh` was performed instead.
- Repository labels: `Claude`, `security`, `CRITICAL` exist. Labels `HIGH`,
  `MEDIUM`, `LOW` do **not** exist on the repo and could not be created
  with the available MCP tools, so non-`CRITICAL` severities are tagged
  with the existing lowercase `high` label where present, otherwise only
  `Claude` + `security`. Severity is recorded inline in the PR/issue
  title and body.
- A long history of prior PRs (#1 - #14) already targets most of these
  findings without being merged. New PRs in this run target the
  designated dev branch `claude/optimistic-ritchie-uoeGi` so they do not
  re-clutter `main`.

## Scope

This is a deep, top-to-bottom review of all server, frontend, shell, and
configuration files. The review covers:

- Hardcoded secrets and credentials.
- Express-level misconfigurations: CORS (none configured), missing
  security headers, no rate limiting, body-size limits, static-file
  exposure.
- Server-side request forgery (the `/api/credly` proxy and the
  `https.get` calls inside `fetchUrl` / `fetchAllBadges` /
  `fetchDisplayName`).
- Command injection or shell metacharacter handling in
  `credly_badge_downloader.sh`.
- Path traversal in static-file serving and in the shell script's
  output-directory construction.
- Authentication weaknesses on the `POST`/`DELETE /api/profiles`
  endpoints.
- DOM-based XSS in `script.js` via `innerHTML` interpolation.
- Subresource integrity for the cdnjs `jszip` `<script>` tag.
- Dependency hygiene (`package.json` declares only `express ^4.21.0`;
  no lockfile is committed).

## Findings

### [CRITICAL] Hardcoded password fallback in server.js

- **File:** `server.js` (line 8)
- **Code:** `const PASSWORD = process.env.APP_PASSWORD || 'certificationitq1!';`
- **Description:** The admin password used to gate `POST /api/profiles`
  and `DELETE /api/profiles` falls back to the literal string
  `certificationitq1!` whenever the `APP_PASSWORD` environment variable
  is unset. Because the repository is public, anyone can read this
  password and add or delete custom profiles on any deployment that
  forgot to set the env var. This is the highest-impact finding: the
  default value is a real, working credential.
- **Remediation:** Remove the fallback string; require `APP_PASSWORD` at
  startup; refuse to boot if it is missing or shorter than a minimum
  length.
- **PR-ready:** yes
- **Action taken:** New PR opened from
  `claude/secfix-remove-hardcoded-password` into
  `claude/optimistic-ritchie-uoeGi`.

### [HIGH] DOM-based XSS via innerHTML interpolation of untrusted Credly + custom-country data

- **File:** `script.js`
  - `createBadgeCard()` (around line 247): interpolates `badgeName`,
    `issuedAt`, `badge.image_url` into `innerHTML`.
  - `createCommonCard()` (around line 308): interpolates `badgeName`,
    `issuer`, and `holdersHtml` (which itself is built from
    `userDisplayNames[h] || h` mapped through string interpolation
    inside an `innerHTML` template).
  - `renderByCertification()` (around line 348): interpolates the
    certification `name` into a `<td>` inside an `innerHTML` template.
  - `initQuickSelect()` (around line 695-720): interpolates `country`
    and `username` into `innerHTML` for the country pills and the
    custom-profile tag list.
- **Description:** Badge templates returned by Credly include
  attacker-controllable strings (badge name, issuer, description,
  user-provided country names persisted server-side in
  `data/custom-profiles.json`). All of these are rendered via
  `el.innerHTML = \`...${value}...\`` without HTML escaping. The most
  exploitable vector is the **custom country name**: a user with the
  shared password can persist `<img src=x onerror=...>` as a country
  name, which is then served to every visitor through `GET
  /api/profiles` and rendered into the page.
- **Remediation:** Add a small `escapeHtml(s)` helper and apply it to
  every interpolation, or rebuild affected nodes with `createElement` +
  `textContent`.
- **PR-ready:** yes
- **Action taken:** New PR opened from `claude/secfix-xss-innerhtml`
  into `claude/optimistic-ritchie-uoeGi`.

### [HIGH] Static file middleware exposes server source, package metadata, and shell script

- **File:** `server.js` (line 12):
  `app.use(express.static(__dirname, { index: false, extensions: ['html', 'css', 'js'] }));`
- **Description:** `__dirname` is the project root, so any file in the
  repository becomes reachable over HTTP (other than directories).
  `package.json`, `package-lock.json` (if it ever lands), the bash
  downloader, and the security review markdown are all served. More
  importantly, `server.js` itself is served (which is how an attacker
  would discover the hardcoded password fallback on a deployment that
  predates a future fix). The `extensions: ['html','css','js']` option
  also lets a request like `/server` resolve to `/server.js`.
- **Remediation:** Move the public assets into a `public/` directory
  and serve only that directory, or add an explicit allow-list of
  files.
- **PR-ready:** yes
- **Action taken:** New PR opened from `claude/secfix-static-expose`
  into `claude/optimistic-ritchie-uoeGi`.

### [HIGH] Plaintext, non-constant-time password comparison

- **File:** `server.js` (lines 234, 257):
  `if (password !== PASSWORD) { return res.status(401)... }`
- **Description:** Direct string `!==` comparison on the secret leaks
  byte-level timing information that, combined with the lack of rate
  limiting (separate finding) on the same endpoints, is theoretically
  exploitable to recover the password. The password is also accepted
  in JSON request bodies on plain HTTP.
- **Remediation:** Use `crypto.timingSafeEqual` over equal-length
  hashes (`crypto.createHash('sha256').update(...).digest()`).
- **PR-ready:** yes; deferred to keep the dev branch's PR queue small,
  recommended to combine with rate-limit fix in a follow-up PR. Filed
  as an Issue instead of a PR in this run.
- **Action taken:** Issue opened.

### [MEDIUM] Missing security headers on Express server (no helmet)

- **File:** `server.js`
- **Description:** No `helmet` middleware. Responses do not set
  `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
  or `Permissions-Policy`. `X-Powered-By: Express` is also leaked.
- **Remediation:** Add `helmet` to `package.json` and mount
  `app.use(helmet({ contentSecurityPolicy: { directives: {...}}}))`
  with a CSP that allows the cdnjs script and `images.credly.com`.
- **PR-ready:** yes
- **Action taken:** New PR opened from `claude/secfix-security-headers`
  into `claude/optimistic-ritchie-uoeGi`.

### [MEDIUM] No rate limiting on auth or proxy endpoints

- **File:** `server.js` (`POST /api/profiles`, `DELETE /api/profiles`,
  `GET /api/credly`, `POST /api/batch-badges`,
  `GET /api/batch-badges-stream`)
- **Description:** Without rate limiting:
  - The shared password is brute-forceable (combined with the timing
    leak above).
  - The Credly proxy can be abused as an open egress amplifier (each
    request fans out to up to 10 concurrent upstream calls in the SSE
    endpoint).
  - The SSE endpoint accepts up to 100 usernames per request and has
    no per-IP cap on concurrent streams.
- **Remediation:** Add `express-rate-limit` with a strict bucket on
  `/api/profiles` (e.g. 20 req / 15 min) and a looser bucket on
  `/api/credly` and `/api/batch-badges*`.
- **PR-ready:** yes; combined with helmet PR to keep churn low.
- **Action taken:** Included in the same PR as the helmet fix.

### [MEDIUM] No Subresource Integrity on cdnjs jszip script

- **File:** `index.html` (line 117):
  `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>`
- **Description:** The script tag has no `integrity=` and no
  `crossorigin=`. A compromise of cdnjs (or DNS hijack of
  `cdnjs.cloudflare.com`) silently substitutes attacker JavaScript that
  runs with full DOM access on every page load.
- **Remediation:** Add the SHA-512 SRI hash published on cdnjs's
  `jszip 3.10.1` page and `crossorigin="anonymous"`. Alternatively,
  vendor `jszip.min.js` from `node_modules/` and serve it locally.
- **PR-ready:** yes
- **Action taken:** New PR opened from `claude/secfix-jszip-sri` into
  `claude/optimistic-ritchie-uoeGi`.

### [MEDIUM] Path traversal in shell script output directory via crafted username

- **File:** `credly_badge_downloader.sh` (lines 73-83 `extract_username`,
  used at line 217 to build `output_dir`)
- **Description:** `extract_username` uses the regex
  `credly\.com/users/([^/]+)` which captures anything that is not a
  forward slash. A URL like
  `https://www.credly.com/users/..%2F..%2Fetc` after URL decoding can
  yield a username with `..` segments that, combined with
  `mkdir -p "credly_badges_${username}_..."`, lets the script create
  directories outside the intended workspace, and lets later
  `mv "$raw_filepath" "$new_raw_filepath"` write to a controlled
  location if the user can also influence OCR text. The script is
  intended for local use, but anyone scripting the tool against
  attacker-supplied URLs is exposed.
- **Remediation:** After extraction, validate that the username matches
  `^[a-zA-Z0-9._-]+$` and reject otherwise.
- **PR-ready:** yes
- **Action taken:** New PR opened from `claude/secfix-shell-path-traversal`
  into `claude/optimistic-ritchie-uoeGi`.

### [LOW] No HTTPS enforcement / password sent in cleartext bodies

- **File:** `server.js` (whole admin path), `script.js` (the modal)
- **Description:** The server does not redirect `http -> https` and the
  client `POST`s the admin password in the JSON body for every
  add/remove operation. On any deployment that exposes plain HTTP, the
  password is observable on the wire and on every reverse-proxy access
  log that records request bodies.
- **Remediation:** Operational; deploy behind a TLS-terminating reverse
  proxy and 308-redirect HTTP. Alternatively, swap to a signed,
  HttpOnly+Secure session cookie established via a single login call.
- **PR-ready:** no (deployment / architecture decision)
- **Action taken:** Issue opened.

### [LOW] No package-lock.json committed; single dependency unpinned by hash

- **File:** `package.json`
- **Description:** `package.json` lists `express ^4.21.0` and there is
  no `package-lock.json` checked in. Reproducible installs and
  supply-chain pinning are absent. `npm audit` cannot run reliably
  against a non-locked tree.
- **Remediation:** Run `npm install --package-lock-only` and commit
  `package-lock.json`. Optionally pin Express to an exact version.
- **PR-ready:** no (lockfile generation requires a local `npm install`
  off-platform; cannot be safely faked from MCP)
- **Action taken:** Issue opened.

## Items intentionally NOT flagged

- `https.get` calls inside `fetchUrl`, `fetchAllBadges`,
  `fetchDisplayName` only ever consume URLs derived from a username
  that has either been hand-curated in `PREDEFINED_PROFILES` or
  validated server-side by the `credly\.com/users/[^\/\s]+/i` regex in
  `POST /api/profiles`. A username containing `@host/path` would be
  rejected by the regex (`/users/[^/\s]+` stops at `/`), so the SSRF
  surface here is limited to the host-allowlisted `/api/credly` proxy,
  which is already gated.
- `credly_badge_downloader.sh` uses `set -e`, quotes all variable
  expansions in command substitutions, and never `eval`s user input,
  so command injection is not viable from the URL even though path
  traversal (above) is.
- `app.use(express.json())` already runs in front of the routes; the
  raw `req.body` reading is not re-implemented.
- The cache implementation in `server.js` is keyed on the full URL and
  enforces a host allowlist on the `/api/credly` path, so cache
  poisoning across hosts is bounded by that allowlist.

## Recommendation

Merge the new PRs in this order:

1. `claude/secfix-remove-hardcoded-password` (CRITICAL)
2. `claude/secfix-xss-innerhtml` (HIGH)
3. `claude/secfix-static-expose` (HIGH)
4. `claude/secfix-shell-path-traversal` (HIGH)
5. `claude/secfix-security-headers` (MEDIUM, helmet + rate-limit)
6. `claude/secfix-jszip-sri` (MEDIUM)

Then triage the open Issues for HTTPS enforcement, timing-safe
password compare (for an eventual auth refactor), and lockfile.
