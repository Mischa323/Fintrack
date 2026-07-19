# FinTrack — Project Guide

Self-hosted personal finance tracker (liquid-glass UI). Multi-account, transactions,
categories, recurring transactions, goals, backups, CSV import, and optional SSO.

## Stack

| Layer     | Tech                                                    |
|-----------|---------------------------------------------------------|
| Frontend  | React 18, Vite, Recharts, Tailwind (served by nginx)    |
| Backend   | Node.js, Express, Prisma ORM (`node:20-slim` / Debian)  |
| Database  | SQLite (via Prisma)                                     |
| Container | Docker / Portainer                                      |

## Repository

- GitHub: `https://github.com/Mischa323/Fintrack` (renamed from `fintrack`; the
  lowercase URL still redirects). Default branch: `master`.

## Layout

```
backend/
  prisma/schema.prisma          # data model (SQLite)
  prisma/migrations/            # applied automatically on container start
  src/index.js                  # Express app + cron jobs + startup
  src/middleware/auth.js        # JWT auth middleware
  src/routes/                   # auth, accounts, transactions, categories,
                                #   recurring, import, stats, goals, backup,
                                #   users, config, version
  src/services/                 # backupService, recurringService, jwtSecret
frontend/
  src/pages/                    # Dashboard, Accounts, Transactions, Categories,
                                #   Recurring, Goals, Import, Settings, Login
  src/api/client.js             # axios API client
  nginx-spa.conf                # serves the SPA AND proxies /api to the backend
nginx/nginx.conf                # legacy standalone proxy (3-service compose only)
docker-compose.yml              # local/dev compose (3 services, builds locally)
portainer-stack.yml             # Portainer "Repository" deploy variant
portainer-stack-webeditor.yml   # Portainer "Web editor" deploy (what we use)
```

## Local development

```bash
npm run install:all      # installs backend + frontend deps (from repo root)
npm run dev              # runs backend (:3001) + frontend (:5173) concurrently
```

Backend only: `cd backend && npm run dev` (nodemon).
DB helpers: `npm run db:migrate`, `npm run db:seed`, `npm run db:studio`.

## Deployment — Portainer web editor (current method)

Deployed by pasting `portainer-stack-webeditor.yml` into Portainer → Stacks →
Add stack → **Web editor**. It works without local source because the build
contexts are **remote git URLs** (`context: https://github.com/...#master:backend`),
so Docker clones and builds the repo itself. No registry, no CI.

Two services only — the frontend image serves the SPA *and* proxies `/api` to the
backend, so the separate nginx service is not used in this deployment (its config
bind-mount is not possible from the web editor).

- Published on host port **8090** (`8090:80` on the frontend service). 8080 was
  already taken on the host.
- **No environment variables are required.** The JWT secret is auto-generated.
- Volumes `db_data` (SQLite DB) and `uploads_data` (import staging) persist.
- First run applies Prisma migrations automatically, then the UI shows a
  first-run screen to create the admin account.

### Updating a deployment
Push to `master`, then Portainer → the stack → **Update the stack** with rebuild
enabled. It does *not* auto-deploy on push. If a redeploy appears to run old code,
Portainer likely reused a cached image — delete the stack (volumes survive) and
prune unused images to force a genuine rebuild.

### Watchtower does not work here
Watchtower updates by pulling newer images **from a registry**. These images are
built locally from the git context and tagged `fintrack-backend:latest` /
`fintrack-frontend:latest`, which exist in no registry — so Watchtower resolves
them to Docker Hub and fails with 401 / "pull access denied". Add
`com.centurylinklabs.watchtower.enable=false` labels to silence it.

To actually get Watchtower auto-updates, images must be published (GitHub Actions
→ GHCR) and the compose switched from `build:` to `image:`. Not set up.

## Versioning / update checking

`backend/package.json` `version` is the **single source of truth** — bump it on
every meaningful change (keep `frontend/package.json` in sync for tidiness).
Currently **1.2.0**.

- `GET /version` → `{ version, buildTime }` (authenticated)
- `GET /version/check` → compares against the `version` in `backend/package.json`
  on `master` via raw.githubusercontent.com, returns `{ current, latest, updateAvailable }`
- Settings page shows `FinTrack v<version> · built <time>` with a
  **Check for updates** button
- `BUILD_TIME` is written by the Dockerfile at image build time (after the source
  copy, so it refreshes when code changes); absent in local dev

The update check only works if the version was bumped — an unbumped release will
report "latest" even when the code differs.

## JWT secret (auto-generated)

`backend/src/services/jwtSecret.js` resolves the signing secret at startup, before
the server accepts requests:

1. `JWT_SECRET` env var, if set (optional external override)
2. `Settings.jwtSecret` stored in the DB
3. Otherwise: generate a random 48-byte secret and persist it to `Settings.jwtSecret`

It lives in the DB (`db_data` volume), so it survives redeploys and is included in
backups. No insecure hardcoded default. The Settings "custom JWT secret" field feeds
step 2. Changing the secret invalidates existing sessions.

## Gotchas already hit (do not regress)

- **Prisma + Alpine is broken.** `node:20-alpine` fails libssl detection, falls back
  to an `openssl-1.1.x` engine that cannot load, and crash-loops `prisma migrate
  deploy` (surfacing in the UI as "Setup failed", because `CMD` uses `&&` so the
  server never starts). Fixed by using `node:20-slim` (Debian) + `binaryTargets`
  including `debian-openssl-3.0.x`. Installing openssl on Alpine did *not* fix it.
- **`npm ci` fails in the Docker build** if lifecycle scripts run: the `postinstall`
  hook runs `prisma generate` (schema not copied yet) and `prisma migrate deploy`
  (no DB at build time). Build uses `npm ci --ignore-scripts`; the client is
  generated explicitly afterwards and migrations run at container start.
- **Imports used to 504.** Per-row category lookup + dedup query + a single-row
  SQLite commit each made imports exceed nginx's 60s timeout. Now: categories
  resolved via one map, existing `externalId`s fetched in one query, inserts
  batched 200-per-transaction. nginx proxy timeouts raised to 300s.

## Data model notes (for bank sync)

- `Transaction` has `externalId`, `importedFrom`, and `@@unique([externalId, accountId])`
  — the idempotent dedup key for imports/syncs.
- `Account` has `iban` and `institution` — maps a FinTrack account to a real bank
  account.
- Import logic (`backend/src/routes/import.js`) upserts on that key. It does **not**
  recalculate account balance; `POST /accounts/:id/recalculate` does that.

## Dashboard time range

The dashboard defaults to **this year**, with a selector for This year / 1 / 2 /
5 years / All time. The choice persists in `localStorage` (`fintrack_dashboard_range`).

- `GET /stats/overview?from=&to=` and `GET /stats/monthly?from=&to=` both accept the range
- `/stats/monthly` buckets **by month** for spans up to 24 months and **by year**
  beyond that, so a 5-year view renders ~5 bars rather than 60. The bucket label
  is returned as `month` either way, which is what the chart's `dataKey` expects.
- Range boundaries are anchored to **UTC midnight** (`Date.UTC`) because
  transaction dates are stored date-only in UTC; a local-midnight boundary
  silently pulled in the previous year's final day.
- "Total Balance" is deliberately *not* range-filtered — it is the accounts'
  current balance, not a sum over the period.

## ABN AMRO bank sync — plan

Goal: sync ABN AMRO transactions into FinTrack. Approaches evaluated:

- **Phase 1 — CAMT.053 file import: DONE (v1.2.0).**
  - `backend/src/services/camt053.js` parses the statement; `services/importTransactions.js`
    holds the shared persistence used by every import source.
  - Routes: `POST /import/camt` (import) and `POST /import/camt/inspect` (preview
    the statement and match an account by IBAN before importing).
  - `externalId` prefers the bank's own reference (`AcctSvcrRef` → `TxId` →
    `EndToEndId` → `NtryRef`), rejecting placeholders like `NOTPROVIDED`. When none
    exists it derives a deterministic hash of the entry content plus an occurrence
    counter — so re-importing the same statement skips, while genuinely identical
    entries in one file remain distinct.
  - `CdtDbtInd` maps `CRDT`→INCOME / `DBIT`→EXPENSE; the counterparty is the
    creditor for outgoing and the debtor for incoming. Pending (`PDNG`) entries
    are skipped.
  - UI: "ABN AMRO" card in the Import wizard. Download from ABN AMRO internet
    banking via **Zelf regelen → Downloaden**, format **CAMT.053 (XML)**.
- **GoCardless Bank Account Data (ex-Nordigen) auto-sync ("Phase 2"):** free tier,
  regulated AISP, supports ABN AMRO (NL). User consents via the bank; backend pulls
  on a schedule (reuse the cron pattern in `backend/src/services/backupService.js`).
  Reuses the Phase-1 transaction mapper.
- ABN AMRO's own PSD2 API directly requires a licensed TPP + eIDAS QWAC — not viable
  for a personal project (sandbox only).

**Status:** Phase 1 shipped in v1.2.0. Phase 2 (GoCardless auto-sync) not started;
it should reuse `persistRows` from `services/importTransactions.js`.

## Conventions

- Route files each instantiate their own `PrismaClient` (existing pattern).
- Secrets live in the `Settings` singleton row; `/config` exposes only booleans like
  `hasCustomJwtSecret`, never secret values.
- Cron jobs live in `src/index.js` (recurring processing daily; backup at 02:00).
