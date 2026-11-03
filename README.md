# Signal Support Desk Challenge

A timed, Zendesk-style in-tray assessment for The Signal Group's customer service candidates.
Candidates read a briefing, triage a randomly drawn queue of 12 tickets (one per theme), work them,
and handle new tickets that drop in every 5 minutes. Results save automatically and are listed,
searchable by name, in the PIN-locked assessor area.

## How it's built

- `public/index.html` — the whole assessment (HTML, CSS and JS in one file).
- `src/worker.js` — Cloudflare Worker that serves the page and stores results in Workers KV.
  - `POST /api/results` saves a finished result.
  - `GET /api/results` lists results (newest first, `?q=` filters by name).
  - `GET /api/results/:id` returns one result.
  - Reading results needs the `x-assessor-pin` header to match the `ASSESSOR_PIN` secret.
- `wrangler.toml` — Worker config. The `RESULTS` KV namespace is `cs-assessment-results`.

## Deploying

Cloudflare Workers Builds deploys this repo on every push to `main` (`npx wrangler deploy`).

One-time set-up in the Cloudflare dashboard:
1. Workers & Pages → Create → Import a repository → pick this repo. Deploy command: `npx wrangler deploy`.
2. Worker → Settings → Variables and Secrets → add secret `ASSESSOR_PIN` (must match the PIN the page expects).
3. Protect the workers.dev address with Cloudflare Access (Zero Trust) so only invited emails can open it.

## Running an interview

Send the candidate the workers.dev link (add `#t35` for a 35-minute session). Afterwards, open the
link, choose **Assessor area**, enter the PIN, then **View all results** and search by name.
