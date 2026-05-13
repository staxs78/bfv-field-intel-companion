# BFV Field Intel Companion

BFV Field Intel Companion is a static, fan-made personal companion for organizing public Battlefield V field-intelligence notes. It helps you generate public source links, manually enter or paste stats, compare suspicious patterns, log evidence, track server sessions, export JSON backups, and prepare neutral official report notes.

This app is not affiliated with EA, DICE, or Battlefield. It uses no official logos, no official artwork, no ads, no tracking, no cookies, no login, no backend database, and no monetization.

Stats are not proof. Use this as triage only. Do not harass. Report through official tools with evidence.

## Mode 1 - Static / Manual

Use the GitHub Pages app or open `index.html` directly in a browser.

- Generate public source links.
- Enter or paste public stats manually.
- Use local suspicion scoring and vehicle-focus classification.
- Keep evidence logs, server/session logs, and neutral report notes.
- Export/import JSON backups.
- Persist data in `localStorage` only.

No npm install, build step, server, database, backend, tracking, or external assets are required for this mode.

## Mode 2 - Live Fetch

The optional Cloudflare Worker in `worker/` can attempt a single public stat lookup per user action.

1. Deploy the Cloudflare Worker.
2. Copy the Worker URL, for example:
   `https://bfv-field-intel-companion.YOUR-SUBDOMAIN.workers.dev`
3. Open the app.
4. Go to Settings -> API Base URL.
5. Paste the Worker URL and save.
6. Use Player Lookup -> Try Live Fetch.

If live fetch fails, the app stays useful: open the public source links and paste stats manually.

## Boundaries

- This does not prove cheating. It is a triage and evidence organization helper only.
- Use official in-game/profile reporting tools with factual evidence.
- Do not harass, threaten, doxx, or mass report anyone.
- No private scraping, protected-page scraping, login scraping, CORS bypass, CAPTCHA bypass, stealth browser, account rotation, IP rotation, fingerprint evasion, or automation evasion.
- No hacking, cheat features, game modification, or unsafe modding.
- No official logos, official artwork, affiliation claims, ads, analytics, cookies, or tracking.

## Worker API

`GET /api/player?name=PLAYERNAME&platform=pc`

Supported platforms:

- `pc`
- `ps4`
- `xboxone`

The Worker returns normalized data when a public no-auth source works, or a clean fallback response when sources are unavailable or blocked. It does not invent stats.

## GitHub Pages

This project is GitHub Pages ready as a static root deployment.

1. Push the repository to GitHub.
2. Open repository settings.
3. Go to Pages.
4. Select `main` as the branch.
5. Select `/ (root)` as the folder.
6. Save.

The `.nojekyll` file is included so GitHub Pages serves the static files directly.
