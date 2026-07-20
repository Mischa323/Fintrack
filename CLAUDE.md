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
  lowercase URL still redirects). Default branch: `main`.

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
contexts are **remote git URLs** (`context: https://github.com/...#main:backend`),
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
Push to `main`, then Portainer → the stack → **Update the stack** with rebuild
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
Currently **1.9.0**.

- `GET /version` → `{ version, buildTime }` (authenticated)
- `GET /version/check` → compares against the `version` in `backend/package.json`
  on `main` via raw.githubusercontent.com, returns `{ current, latest, updateAvailable }`
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

## Maybe Finance import (multi-account)

A Maybe export puts **every account in one transactions.csv**, identified by an
 column. That column was parsed into  but never used, so a
single target account was applied to every row and transactions landed on the
wrong accounts.

-  returns the account names in the file with row
  counts and the FinTrack account each matches by name.
-  takes  ({ csv name -> account id }); rows are
  grouped by account name and persisted per group.  remains the
  fallback for rows with no account name, so single-account files still work.
- An unmapped group is **skipped and reported**, never silently redirected.

## Investments (holdings)

No broker offers an API for **personal** accounts — Revolut included — and PSD2
covers payment accounts only, so open banking would not help either. FinTrack
therefore never learns *which* shares you own; you enter or import those once.
What it does automatically is keep their **prices** current, which is the part
that actually changes daily.

- `Holding` model: symbol, quantity, avgCost, currency, lastPrice, lastPriceAt,
  unique per `[accountId, symbol]`.
- `services/quotes.js` — `fetchQuote()` is the only place that knows the quote
  provider (Yahoo's chart endpoint: free, no key, US + European tickers). It is
  an **unofficial** endpoint, so if it breaks only that function changes.
- FX via frankfurter.app (ECB rates, no key), resolved once per run and cached.
  A rate that cannot be fetched values the position unconverted and is reported,
  rather than failing the whole refresh.
- `recalculateAccountValue()` sets an investment account's balance to
  Σ(quantity × lastPrice × fx), so the balance is derived, not typed in.
- Cron refreshes prices weekday mornings (`30 6 * * 1-5`).
- Adding a position looks the price up immediately, so a bad ticker is rejected
  at entry instead of sitting at zero until the next refresh. European tickers
  need their suffix (ASML.AS, SHELL.AS, MC.PA).
- **Revolut import** (`POST /holdings/import/revolut`) takes the Stocks account
  statement. Revolut exports *trades, not positions*, so positions are derived:
  buys and sells netted per ticker, average cost weighted across buys, and a
  fully sold ticker is dropped. Dividends, fees and top-ups are ignored.
  Column matching is fuzzy since the export format varies.

## Bulk transaction actions

`POST /transactions/bulk-delete { ids }` and `PATCH /transactions/bulk
{ ids, categoryId?, type?, notes? }`.

- Balances are corrected **once per account** (`collectAdjustments` builds a net
  delta map) rather than once per row.
- Bulk `type` accepts INCOME/EXPENSE only; TRANSFER rows are left untouched and
  reported as `skippedTransfers`, because a transfer's direction depends on
  `toAccountId` and cannot be inferred in bulk.
- Amount and date are deliberately not bulk-editable.
- The UI clears the selection whenever the visible rows change, so a selection
  hidden by a filter or page change can never be acted on by mistake.

## Merging categories

Imports create a category per name encountered, so near-duplicates accumulate
("Groceries" / "Boodschappen"). `POST /categories/merge { sourceIds, targetId }`
folds them together; `GET /categories/flat` lists every category with usage
counts for the picker.

Order inside the transaction matters:
1. **Detach the target first** if it sits under a source — otherwise the
   reparent below sets its `parentId` to itself and corrupts the tree
   (verified: without this guard `parentId === id`).
2. Reparent the sources' sub-categories to the target.
3. Repoint transactions and recurring transactions to the target.
4. Delete the sources.

Nothing is left uncategorised — unlike `DELETE /categories/:id`, which
deliberately nulls the category on its transactions.

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
  - UI: "ABN AMRO" card in the Import wizard. The real download path is
    **Zelf regelen → Overzichten en afschriften → Bij- en afschrijvingen
    downloaden**, file type **CAMT.053 (XML)**.
  - **Multi-file:** ABN issues one small file per day, so `/import/camt` and
    `/import/camt/inspect` take `files[]` (up to 400) and merge them into one
    import. Files covering more than one IBAN are rejected rather than mixed
    into a single account.
  - **IBAN matching is normalised** (`services/iban.js`): spaces/dashes stripped
    and uppercased on save and on compare, because an IBAN copied from the bank
    ("NL69 ABNA 0624 4857 06") never matched the CAMT form. Existing rows were
    normalised by the migration; comparison happens in JS so legacy rows match.

## Transfers between own accounts

A transfer appears twice in bank data (out of A, into B). FinTrack stores it as
ONE row: `accountId` (from) → `toAccountId` (to), and `/stats` counts only
INCOME/EXPENSE, so a linked transfer correctly stays out of income and expense.

`services/transfers.js` implements three modes, default in
`Settings.transferDetection`, overridable per import via `transferMode`:

| Mode | Behaviour |
|---|---|
| `off` | Everything stays INCOME/EXPENSE |
| `auto` | Matching entries become TRANSFER rows during import |
| `confirm` (default) | Import normally, then surface candidates to confirm |

- Matching uses the counterparty IBAN against accounts' IBANs, amount, and a
  **±4 day** window (`MATCH_WINDOW_DAYS`).
- Candidates come in two kinds. A **pair** is both legs imported, merged into one
  row. A **single** is only one side imported — common when you import just your
  current account — and is converted in place, since that row already names both
  the account and the counterparty IBAN. Without singles, confirm mode found
  nothing at all for anyone importing one statement.
- In `auto`, the mirror leg is skipped when a matching TRANSFER already exists
  (`mirrorLegExists`) or was created earlier in the same batch — this is what
  stops the two statements of one transfer double-counting.
- `persistRows` dedups on `externalId` matching **either** `accountId` or
  `toAccountId`, because a transfer detected from one side is stored under the
  paying account but still represents the other statement's row.
- `POST /accounts/:id/recalculate` counts incoming transfers via `toAccountId`;
  it previously ignored transfers entirely and produced wrong balances.
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
