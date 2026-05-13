# AGENTS.md

## Project

BFV Field Intel Companion is a static fan-made personal companion for manual public-source stat review, evidence organization, server-session notes, and factual report drafting.

## Safety And Conduct

- No cheats.
- No hacks.
- No harassment.
- No doxxing.
- No mass reporting.
- No EA login/private scraping.
- No CORS bypass.
- No stealth scraping.
- No CAPTCHA bypass.
- No account rotation, IP rotation, fingerprint evasion, or automation evasion.
- No monetization, ads, analytics, tracking, cookies, or contact forms.
- No official logos, official artwork, or affiliation claims.

## Data Workflow

- Manual/public-source only is the primary workflow.
- Optional public endpoint fetches must fail gracefully.
- Do not invent API success.
- Do not scrape protected or private pages.
- BFVHackers, Battlefield Tracker, BFBan, EA, and similar sites are link/manual only unless a public browser-safe endpoint is explicitly documented and proven.
- No hidden polling or aggressive retries.

## Wording

- Use suspicion and evidence-triage language only.
- Allowed labels: Legit, Watch, Suspicious, Very Suspicious, Report-worthy evidence.
- Do not automatically apply certainty labels to a player.
- Always keep the reminder visible: "Stats are not proof. Use this as triage only. Do not harass. Report through official EA tools with evidence."

## Technical Constraints

- Static browser app only.
- HTML/CSS/vanilla JavaScript only.
- No React.
- No npm.
- No backend.
- No database.
- No external assets.
- No tracking.
- No cookies.
- localStorage only.
- Must work by opening `index.html` directly.
- GitHub Pages should deploy from `main` and `/ (root)`.
