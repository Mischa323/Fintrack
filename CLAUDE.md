# FinTrack — Project Guide

Self-hosted personal finance tracker (liquid-glass UI). Multi-account, transactions,
categories, recurring transactions, goals, backups, CSV import, and optional SSO.

## Stack

| Layer     | Tech                                          |
|-----------|-----------------------------------------------|
| Frontend  | React 18, Vite, Recharts, Tailwind (served by nginx) |
| Backend   | Node.js, Express, Prisma ORM                  |
| Database  | SQLite (via Prisma)                           |
| Proxy     | Nginx (routes `/api` → backend, `/` → frontend) |
| Container | Docker / Portainer                            |

## Repository

- GitHub: `https://github.com/Mischa323/Fintrack` (repo was renamed from `fintrack`;
  the lowercase URL still redirects). Default branch: `master`.

## Layout

```
backend/
  prisma/schema.prisma          # data model (SQLite)
  prisma/migrations/            # applied automatically on container start
  src/index.js                  # Express app + cron jobs + startup
  src/middleware/auth.js        # JWT auth middleware
  src/routes/                   # auth, accounts, transactions, categories,
                                #   recurring, import, stats, goals, backup,
                                #   users, config
  src/services/                 # backupService, recurringService, jwtSecret
frontend/
  src/pages/                    # Dashboard, Accounts, Transactions, Categories,
                                #   Recurring, Goals, Import, Settings, Login
  src/api/client.js             # axios API client
  nginx-spa.conf                # SPA nginx config (frontend image)
nginx/nginx.conf                # top-level reverse proxy (nginx service)
docker-compose.yml              # local/dev + original Portainer compose
portainer-stack.yml             # production stack for Portainer Repository deploy
```

## Local development

```bash
npm run install:all      # installs backend + frontend deps (from repo root)
npm run dev              # runs backend (:3001) + frontend (:5173) concurrently
```

Backend only: `cd backend && npm run dev` (nodemon).
Useful DB commands: `npm run db:migrate`, `npm run db:seed`, `npm run db:studio`.

## Deployment — Portainer (Repository method)

The images build **from source**, so use Portainer's **Repository** deploy method
(it clones the repo, then builds). The **web editor cannot build from source** — it
only runs pre-built images — so it does not work for this app as-is.

Portainer → Stacks → Add stack → **Repository**:

| Field                | Value                                    |
|----------------------|------------------------------------------|
| Repository URL       | `https://github.com/Mischa323/Fintrack`  |
| Repository reference | `refs/heads/master`                      |
| Compose path         | `portainer-stack.yml`                    |

**Environment variables: none required.** Optional:

| Variable                    | When to set                                             |
|-----------------------------|---------------------------------------------------------|
| `WEB_PORT`                  | Change published host port (default `8080`)             |
| `JWT_SECRET`                | Only to pin the secret externally (otherwise auto-gen)  |
| `FRONTEND_URL` / `APP_URL`  | Only when enabling Google/Microsoft SSO (public URL)    |

Persistent volumes: `db_data` (SQLite DB — includes the JWT secret) and
`uploads_data` (import staging). Both survive redeploys.

First run: backend runs Prisma migrations automatically, then the app shows a
first-run screen to create the admin account.

### Web-editor deployment (not set up yet)
To deploy via Portainer's web editor like other stacks, the images must be
pre-published. The plan (not yet built) is: GitHub Actions builds backend +
frontend images and pushes them to GHCR on every push; a slim compose then just
*pulls* `ghcr.io/mischa323/fintrack-*`. This would also fold the `/api` proxy into
the frontend image and drop the separate nginx service (its config bind-mount is
another thing the web editor can't do).

## JWT secret (auto-generated)

`backend/src/services/jwtSecret.js` resolves the signing secret with this
precedence, initialized once at startup before the server accepts requests:

1. `JWT_SECRET` env var, if set (optional external override)
2. `Settings.jwtSecret` stored in the DB
3. Otherwise: generate a random 48-byte secret on first boot and persist it to
   `Settings.jwtSecret`

Because it lives in the DB (`db_data` volume), it survives redeploys and is included
in backups. There is no insecure hardcoded default. The "custom JWT secret" field in
Settings writes precedence step 2, so it now takes effect. Changing the secret
invalidates existing sessions (users log in again once).

## Data model notes (for bank sync)

- `Transaction` has `externalId`, `importedFrom`, and `@@unique([externalId, accountId])`
  — the idempotent dedup key for imports/syncs.
- `Account` has `iban` and `institution` — used to map a FinTrack account to a real
  bank account.
- Import logic (`backend/src/routes/import.js`) upserts transactions on that key and
  recalculates account balance.

## ABN AMRO bank sync — plan

Goal: sync ABN AMRO transactions into FinTrack. Two approaches evaluated:

- **File import (chosen first — "Phase 1"):** parse ABN AMRO **CAMT.053 (XML)** (or
  CSV) exports and feed them through the existing import upsert path. No third party,
  fully local, manual download+upload. Best data quality with CAMT.053 (structured
  counterparty IBAN/name, stable reference for `externalId`, signed amounts).
- **GoCardless Bank Account Data (ex-Nordigen) auto-sync ("Phase 2"):** free tier,
  regulated AISP, supports ABN AMRO (NL). User consents via the bank; backend pulls
  accounts + transactions on a schedule (reuse the cron pattern in
  `backend/src/services/backupService.js`). Reuses the Phase-1 transaction mapper.
- ABN AMRO's own PSD2 API directly requires a licensed TPP + eIDAS QWAC — not viable
  for a personal project (sandbox only).

**Status:** Phase 1 (CAMT.053 import) is the next task, to start after the Portainer
deployment is confirmed working.

## Conventions

- Route files each instantiate their own `PrismaClient` (existing pattern).
- Secrets are stored in the `Settings` singleton row; the `/config` API only exposes
  booleans like `hasCustomJwtSecret`, never secret values.
- Cron jobs live in `src/index.js` (recurring processing daily; backup at 02:00).
