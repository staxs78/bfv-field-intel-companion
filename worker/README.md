# BFV Field Intel Companion Worker

This Cloudflare Worker provides an optional public-stat fetch layer for the static BFV Field Intel Companion. It does not scrape private pages, does not use logins, does not bypass CORS, and does not invent stats. If public sources fail, it returns a clean fallback response for manual entry.

## Endpoint

`GET /api/player?name=PLAYERNAME&platform=pc`

`GET /api/diagnostics?name=PLAYERNAME&platform=pc`

`GET /api/sources?name=PLAYERNAME&platform=pc`

Supported platforms: `pc`, `ps4`, `xboxone`

The diagnostics and sources endpoints return adapter URLs, HTTP status, content type, raw previews, parse status, usable fields, source status, and readable errors. They are for debugging public no-auth source behavior only and expose no secrets.

The Worker currently treats GameTools documented BFV endpoints as fetch sources and keeps BFVHackers, BFBan, Battlefield Tracker, and EA as link/manual sources. It does not scrape protected pages or convert community labels into automatic certainty claims.

## Option A - Deploy With Cloudflare Plugin

If Cloudflare deployment is available in Codex, Codex can deploy `worker/worker.js` and report the Worker URL.

## Option B - Manual Wrangler Deployment

1. Install Wrangler if needed:
   `npm install -g wrangler`
2. Login:
   `npx wrangler login`
3. From the repo root:
   `cd worker`
4. Deploy:
   `npx wrangler deploy`
5. Copy the `workers.dev` URL.
6. Paste the URL into the app Settings -> API Base URL.
7. Test player lookup with Try Live Fetch.

Expected URL format:

`https://bfv-field-intel-companion.YOUR-SUBDOMAIN.workers.dev`
