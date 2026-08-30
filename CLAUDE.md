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
                                #   Recurring, Goals, Loans, Import, Settings, Login
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
Currently **1.32.0**.

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

## Auth token storage / "Keep me signed in" (v1.29.0)

The JWT is stored in a **cookie**, not localStorage — `frontend/src/api/tokenStore.js`
is the single place that reads/writes it (`getToken`/`setToken`/`clearToken`).
`client.js` attaches it as an `Authorization: Bearer` header and clears it on 401;
`AuthContext` seeds state from it and `login(token, remember)` / `logout` go through
it. The cookie is deliberately **not httpOnly** because the backend authenticates by
Bearer header, so JS must read the token back.

- **"Keep me signed in"** (Login checkbox, default on): checked → a persistent
  cookie (`Max-Age` 30 days); unchecked → a session cookie the browser drops on
  close. The backend mirrors this — `signToken(user, remember)` issues a **30d**
  token when remembered, else **7d** — so a persistent cookie is not left holding a
  token the server already rejects. `POST /auth/login` takes `remember`; SSO and
  first-run setup persist (`login(token, true)`).
- A token left in `localStorage` by an older version is migrated to a cookie on
  first `getToken()`.

## Login brute-force protection (v1.30.0)

Block an IP after too many failed logins, configurable in Settings → server config.
`Settings.loginBlockEnabled` / `loginMaxAttempts` (default 5) / `loginBlockMinutes`
(default 15); per-IP counters live in the `LoginAttempt` table (survives restart).

- `services/loginGuard.js` is the whole mechanism: `checkBlocked` (refuse while
  `blockedUntil` is in the future), `recordFailure` (increment within the window,
  set `blockedUntil` and reset the counter once the limit is hit), `recordSuccess`
  (delete the IP's row), `clearAll`. `POST /auth/login` calls them — a wrong
  password **or** wrong 2FA code counts; `requires2FA` does not.
- **Real client IP behind nginx**: `getClientIp` reads `X-Real-IP` (nginx sets it
  to `$remote_addr`) then `X-Forwarded-For`, then the socket. Express has no
  `trust proxy`, so don't switch to `req.ip`. nginx-spa.conf now also sets
  `X-Forwarded-For`. Only nginx talks to the backend, so these headers are trusted.
- Blocked responses are **429** with a "try again in N minutes" message; the Login
  page shows it via the existing error path.
- **Self-lockout recovery**: `POST /config/login-blocks/clear` (Settings button
  "Clear all IP blocks now") wipes all blocks — usable from another still-signed-in
  device; otherwise the block lifts on its own. Like the rest of `/config`, it is
  authed but not admin-only (the app's model treats any signed-in user as admin).

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
`account` column. That column was parsed into `accountName` but never used, so
the single target account chosen in the wizard was applied to every row and
transactions from all accounts landed on one.

- `POST /import/maybe/inspect` returns the account names in the file with row
  counts and the FinTrack account each matches by name.
- `POST /import/maybe` takes `accountMap` (`{ csv name: account id }`); rows are
  grouped by account name and persisted per group. `accountId` remains the
  fallback for rows with no account name, so single-account files still work.
- An unmapped group is **skipped and reported**, never silently redirected.

## Category colours (also the spending-chart palette)

Category colours double as the dashboard pie slices, so they must stay distinct
on the dark chart surface. The first eight (`Categories.jsx` `COLORS`) were
validated with the dataviz skill: worst adjacent CVD ΔE 8.4, normal-vision 19.3.
The previous set failed hard — indigo vs violet measured ΔE 0.8 (colourblind) /
6.3 (normal), effectively identical. Past eight hues no ordering clears the
floors, so `EXTRA_COLORS` and the free colour picker are offered as "harder to
tell apart" — the chart leans on labels and tooltips there, not hue. Re-validate
with `dataviz/scripts/validate_palette.js` against surface `#12263a` before
changing these.

## Talking to Ollama (services/ollama.js)

FinTrack is self-hosted, so **it cannot assume which model is configured**. One
shared `generateJson()` absorbs the differences; features never call Ollama
directly.

What it handles, each found by testing rather than guessed:
- A **thinking model leaves `response` empty** and puts the answer in
  `thinking`. `JSON.parse(response)` then threw and a whole batch was counted as
  a silent failure — measured: 0 of 12 transactions labelled. Both fields are now
  searched, and JSON is brace-matched out of surrounding prose.
- **Truncation**: reasoning eats `num_predict` and the answer is lost
  (`done_reason: "length"`). Retried once with triple the budget.
- **`format:"json"` cuts both ways**: it keeps text models reliable but empties
  the reply of some vision models. Callers choose via `constrain`, and the retry
  flips it if the first attempt came back empty.
- Failures **name their cause** ("spent the whole budget reasoning") instead of
  reporting nothing, and `suggestForTransactions` returns `failureReason`.

Verified across three configurations — normal, a thinking model used for
everything, and no vision model at all — labelling, PDF and photo each either
work or fail with a message that says what to change.

## Local AI (Ollama)

Optional: point FinTrack at an Ollama the user runs to suggest categories and
tidy imported transaction descriptions. Configured in Settings → Local AI
(`Settings.aiUrl`, `Settings.aiModel`); nothing is sent anywhere else.

- `services/ai.js` batches 20 transactions per request, temperature 0,
  `format: "json"`.
- **Ask for a wrapped array** (`{"results":[...]}`). With a bare array a 7B model
  returns only the first object — measured: 1 of 8 rows.
- Suggestions are **never applied automatically**. `POST /ai/suggest` proposes,
  the UI shows each next to the original, `POST /ai/apply` writes only what was
  confirmed. Small models misfile categories and do occasionally invent a word
  (observed: `Zorgverzkekering` → `Zorgverzekeringsmaandag`).
- A suggested category that does not exist is rejected and reported rather than
  created, so the model cannot invent categories.
- `POST /ai/categories/suggest` proposes category **merges** (a specific category
  folded into a broader one); the UI shows each with the model reasoning and
  merges via `POST /categories/merge`. Phrase the prompt as "find the specific
  ones", not "merge if you think you should" — offered the easy out, a 7B model
  returns an empty list every time. `unwrap()` tolerates bare arrays and any
  wrapper key, since the model is inconsistent about which it uses.
- The prompt is language-aware: `Settings.aiLanguage` gives a primary-language hint, empty = multilingual (a Dutch account with German/French purchases works either way). Merchant names are kept in their own language, never translated.
- The container cannot reach the host on `localhost`; default is
  `host.docker.internal:11434`, and Ollama needs `OLLAMA_HOST=0.0.0.0`.
- The prompt carries category hints (fuel -> Transportation, supermarkets ->
  Groceries) because without them a 7B model filed petrol under Utilities.
- **The prompt must let the model return an empty category (v1.24.1).** The old
  prompt demanded "exactly one from the list", so when nothing fit a weak model
  dumped everything into whatever sat early in the list (observed: every
  streaming/app/subscription — YouTube, Crunchyroll, Google Play, Kavita —
  labelled "groceries"). `buildPrompt` now (a) allows `""` when nothing fits and
  says a blank beats a wrong guess, (b) forbids defaulting to a groceries/food
  category, and (c) lists what each merchant *is* (streaming/apps/subscriptions,
  dining, web shops, telecom, utilities, insurance, housing, fees, salary) so the
  model maps to the closest existing category. A suggested name not in the list is
  still rejected and reported (the inline "+ New" category button in the
  transaction modal makes adding the missing one quick).
- **The suggested category is fuzzy-matched to the real list (v1.30.1).** The
  concept words a weak model returns rarely equal a user's exact names, so almost
  everything came back "does not exist" (observed: `transport`→no match though
  `Transportation` exists, `salary`→`Income`, `dining`→nothing). `resolveCategory`
  in `services/ai.js` now tries exact, then a substring either way (≥4 chars, so
  `transport`⊂`transportation`), then a small synonym table (salary→income,
  fuel→transport, …). No match still returns null and is reported, so nothing is
  mis-filed silently.

## Receipts, invoices and payslips

Upload receipts, invoices or payslips (images and PDFs, several at once) and each
is read and matched to the transaction it belongs to. `services/receipts.js`
extracts, `routes/receipts.js` stores and links. Files live in `uploads/receipts`.

**Two models, deliberately separate** (`Settings.aiModel` and
`Settings.aiVisionModel`):
- **PDFs are read as text**, never rasterised — `pdf-parse` pulls the text and the
  ordinary text model extracts from it. Measured on a real invoice and payslip:
  **1.6-1.8s and correct**, against 60s and a failure through the vision model.
- **Images** go to the vision model. ~20s for a receipt photo.
- A scanned PDF (no text layer) is rejected with a message telling the user to
  upload a photo instead.

Vision-model gotchas, all worked around (qwen3-vl on Ollama 0.32):
- **Never set `format`** on an image request. Both `format:"json"` and a JSON
  schema return an *empty* response; free text works. The text path does use
  `format:"json"`, which is what keeps it reliable.
- **`think:false` is ignored.** It reasons regardless, and the reasoning consumes
  `num_predict` — on a long payslip it burned 11k characters of thinking and never
  answered, even at 6000 tokens. This is why text does not go through it.
- Field names and formats drift per run (`total_amount` vs `amount`, `12-07-2026`
  vs ISO, `"21,80"`), so `pick()` accepts several names and the parsers handle
  day-first dates and comma decimals.

Matching scores amount first (>0.5 apart is rejected outright), then date within
±10 days (an invoice date is not the payment date), then a merchant-word hit; a payslip matches INCOME, everything else
EXPENSE. Only >=90 counts as strong.

`POST /receipts/auto-link` links every pending document whose best candidate is
strong **and** unambiguous (no runner-up scoring as high), leaving the rest for
review — so a batch can be approved in one click without guessing. Nothing else
is ever written automatically; the image is shown beside the values so a misread
digit is caught before it becomes a transaction. When the automatic match misses, a manual search (GET /receipts/search-transactions, by description or amount, all dates) links an existing transaction instead of creating a duplicate.

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
- **`recalculateBalance()` delegates to it for INVESTMENT accounts** (v1.23.1).
  Every balance recompute funnels through `recalculateBalance` — the ↻ button,
  imports (`import.js`), and transfer removal. It used to sum transactions for
  all types, so a transfer funding an investment account (or any import that
  triggered a recalc) clobbered the holdings-derived balance with the transfer
  total. Now investment accounts recompute from holdings there too, and
  `reconcileToBalance` ("Set balance") ignores a typed figure for them (the UI
  hides the button; the route returns 400).
- Cron refreshes prices weekday mornings (`30 6 * * 1-5`).
- Adding a position looks the price up immediately, so a bad ticker is rejected
  at entry instead of sitting at zero until the next refresh. European tickers
  need their suffix (ASML.AS, SHELL.AS, MC.PA).
- **Revolut import** (`POST /holdings/import/revolut`) takes the Stocks account
  statement. Revolut exports *trades, not positions*, so positions are derived:
  buys and sells netted per ticker, average cost weighted across buys, and a
  fully sold ticker is dropped. Dividends, fees and top-ups are ignored.
  Column matching is fuzzy since the export format varies.

## Holding trades (buy/sell history)

A `Trade` (BUY/SELL, quantity, price, date) records changes to a holding. The
holding quantity and avgCost are **derived by replaying its trades** in order, so
deleting a mistaken entry recomputes cleanly. Selling leaves avg cost per share
unchanged; buying weights it. A position added or imported before any trades gets
a one-off `opening` trade seeded from its current quantity/avgCost the first time
a trade is recorded, so the ledger stays complete. The opening trade always
replays first regardless of later trade dates. `GET/POST /holdings/:id/trades`,
`DELETE /holdings/:id/trades/:tradeId`.

The buy/sell modal (`HoldingTradesModal` in `Accounts.jsx`) was defined but never
rendered — the ⇄ button set state that nothing displayed, so recording trades was
dead from the UI. It is now rendered inside `HoldingsModal`.

## Investment accounts: transfers only, value chart, loss alerts

Three things an investment account needs that a normal account does not, all
added in v1.21.0.

**No income/expense — transfers and the trade ledger only.** An investment
account's balance is `recalculateAccountValue()` over its holdings, so a typed
income or expense on it is meaningless and would be clobbered on the next price
refresh. `POST /transactions` rejects any non-TRANSFER row whose `accountId` is an
INVESTMENT account (400). Transfers in/out are allowed (that is how money reaches
the account to buy, and leaves when you sell). The Transactions add-form mirrors
this: picking an investment account for expense/income shows a notice with a
"Switch to transfer" button and disables Save. Buys and sells live under Holdings.

**Value over time** (`services/valueHistory.js`, `GET /holdings/history?accountId=&range=`).
Reconstructs what the account was worth on each past day as
Σ(quantity-that-day × close-that-day × FX-that-day) — real history, not
forward-only snapshots, so the chart is populated the moment a position exists.
- Quantity per day: a holding **with recorded trades** replays them dated on or
  before the day (appears from its opening date, each buy/sell adjusts). A holding
  with **no trades** (imported) assumes the *current* quantity throughout, since
  the real purchase dates are unknown — the chart then shows how what you hold now
  has moved, which is what was asked for.
- Each symbol's last close is **carried forward across the shared day axis**, so a
  day one market is closed (a US holiday, or Amsterdam's) does not drop that
  holding to zero and make the line zigzag. Verified: a mixed EUR/USD account no
  longer dips on 1 May (NL Labour Day).
- Reuses the Yahoo chart endpoint (`interval=1d&range=`) and Frankfurter's range
  endpoint for FX; both already used by `services/quotes.js`. Ranges: 1mo/3mo/6mo/
  1y/2y/max. Recharts `AreaChart` in `Accounts.jsx` `ValueHistoryChart`.

**Loss alerts** (`Holding.lossAlertPercent`, user-set per position). `withGain()`
in `routes/holdings.js` adds `gainPercent` and `alertTriggered` (true when the
unrealised gain vs avgCost is ≤ −threshold) to every holding in `GET /holdings`.
`GET /holdings/alerts` returns just the breached positions for a badge/summary.
`PUT /holdings/:id` takes `lossAlertPercent` (absolute value; `""`/`null` clears).
The Holdings table shows a 🔔/🔕 toggle per row and a red "past −X% alert" marker
when triggered. Nothing is pushed anywhere — the alert is surfaced in the UI.

## Manually-valued investment accounts (funds/pensions) (v1.26.0)

Some investment accounts hold products with **no tradeable ticker** — Brand New
Day, a pension pot — so their worth can't be priced from Yahoo. `Account.manualValue`
lets the user enter that worth by hand.

- `recalculateAccountValue` (services/quotes.js) seeds `total` with `manualValue`
  then adds any priced holdings, so a holding-less account is worth exactly the
  hand-entered number, and the ↻ button keeps it there instead of resetting to 0.
- `POST /accounts/:id/value { value }` (investment accounts only) sets `manualValue`,
  recalculates, and writes a daily `AccountValueSnapshot`. UI: a "€ Set value"
  button on the investment account card (the ticker-based flow, "Set balance", is
  still blocked/hidden for investment accounts).
- **Value chart still works**: `accountValueHistory` can't reconstruct history from
  prices for these, so when an account has no holdings it returns the snapshot
  series instead — a forward-only chart that fills in as values are entered. The
  chart renders in the Holdings modal when the account has holdings **or** a
  `manualValue`. `AccountValueSnapshot` is `@@unique([accountId, date])`, upserted
  per UTC day.

## Money lent (loans to people)

Track money lent to a person and log repayments so the outstanding balance is
always visible. Added in v1.22.0. `Loan` (person, description, principal,
currency, date, dueDate, notes, color, archived) + `LoanPayment` (amount, date,
notes); `routes/loans.js`, page `Loans.jsx`, nav "Money Lent".

- **Standalone by default, optionally linked to an account** (`Loan.accountId`,
  added v1.23.0). Left unlinked it is pure tracking that never moves a balance —
  who owes what, not a movement of money (the same choice Goals makes). Linked,
  the money is booked as real transactions so a chosen account's balance stays in
  step (see below).
- **Outstanding is derived, never stored** — `withComputed()` returns `repaid`
  (Σ payments), `outstanding` (principal − repaid), `settled` (≤ a cent of
  slack), `overpaid`, and `progress` %. Deleting a mistaken repayment recomputes
  cleanly, the same pattern as a holding replaying its trades.
- `GET /loans` lists active loans (`?includeArchived=true` adds filed-away ones);
  `GET /loans/summary` gives header totals (lent, repaid, outstanding, people).
- `POST/PUT/DELETE /loans[/:id]`, `POST /loans/:id/archive { archived }` to file a
  settled loan without deleting its history, and
  `GET/POST /loans/:id/payments` + `DELETE /loans/:id/payments/:paymentId`.
- UI: cards with a repaid/principal progress bar and the amount still owed, an
  Overdue flag when `dueDate` has passed unpaid, a Paid-off badge when settled,
  and a repayment modal (history + "fill in the remaining" shortcut).

**Account linking (v1.23.0).** Give a loan an `accountId` and lending is booked as
an EXPENSE on it, each repayment as an INCOME — so a full repayment nets back to
the starting balance and the account is always right. Every booking is a real
`Transaction` row, because `recalculateBalance` is openingBalance + Σ(transactions)
and a direct balance nudge would be undone on the next recalc. `bookTx`/`reverseTx`
in `routes/loans.js` create and undo those rows (adjusting the balance by ±amount);
the ids live on `Loan.lendTransactionId` and `LoanPayment.transactionId`.
- **PUT rebooks cleanly**: it reverses every booking the loan made, applies the
  edits, then re-creates them on the (possibly new) account — so changing the
  amount, dates, or the linked account itself stays consistent, including moving
  all past repayments to a newly chosen account.
- **DELETE** (loan or payment) reverses the bookings first, leaving the balance as
  if the loan had never touched it. `reverseTx` no-ops if the user deleted the
  transaction directly in the Transactions page, so a dangling id is harmless.
- **Investment accounts are rejected** (`checkLinkable`) — their balance comes from
  holdings and would be clobbered on the next price refresh; the picker hides them.
- These rows show as ordinary INCOME/EXPENSE in stats. Caveat: if the same money
  also arrives via a bank import, it is counted twice — leave the loan unlinked to
  avoid that, or reconcile. Linking is opt-in per loan.

## Account ordering and grouping (v1.24.0)

Accounts have `sortOrder` (Int) and `groupName` (String?). `GET /accounts` orders
by `[{ sortOrder }, { createdAt }]` — the createdAt tiebreak keeps pre-feature
accounts (all at 0) in their original sequence. `PUT /accounts/reorder { ids }`
persists a new order (sortOrder = index); it is declared **before** `/:id` so the
literal "reorder" is not captured as an id. New accounts get `max(sortOrder)+1`.

- The Accounts page (`Accounts.jsx`) renders accounts grouped by `groupName` under
  headings with a per-group balance subtotal; ungrouped accounts fall under an
  "Ungrouped" heading (only shown when at least one group exists).
- **Cards reorder by drag** via a `⠿` handle (native HTML5 DnD, no library):
  dragging over a card moves the dragged one to that spot **and adopts the
  target's group**, so dropping a card onto another group moves it there. On drop,
  `finishDrag` saves the order and the moved card's group. (Per-card ▲▼ buttons
  existed in v1.25.0 but were removed in v1.26.1 as clutter — drag covers it.)
- **Group headings keep ▲▼ buttons** to move a whole group up/down (`moveGroup` →
  `persistOrder` → `reorder`), operating on the grouped structure and flattening
  it back so groups stay contiguous.
- `GlassCard` now spreads `...rest` onto its div so it can be a drop target.
- The group is set in the account Edit form: a free-text input **plus clickable
  chips of existing groups** (v1.25.0 — a `<datalist>` was invisible to the user,
  so existing groups never appeared as pickable options).

## Transaction modal shortcuts (v1.24.0)

Three quick-entry conveniences in the Add/Edit Transaction form (`Transactions.jsx`):
- **Remembers the account you're on**: opening "Add" while filtered to one account
  defaults the account (and a transfer's "from") to it — `open()` seeds
  `accountId` from `filters.accountId` before falling back to the first account.
- **Inline category creation**: a "+ New" button beside the category select
  prompts for a name, `POST /categories`, reloads, and selects it — no trip to the
  Categories page.
- **Make it a subscription**: a toggle (new income/expense only; recurring
  transfers aren't modelled) reveals a frequency picker. On save it records the
  one-off payment now **and** creates a `RecurringTransaction` whose `startDate` is
  the *next* period (`nextPeriod()` mirrors `addPeriod()` in recurringService), so
  today's charge isn't duplicated.

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

## Dashboard widgets

The dashboard (`Dashboard.jsx`) is a customisable widget grid — multiple named
dashboards, drag-to-reorder, per-widget width (12-col grid), all persisted in
`localStorage` (`fintrack_dashboards_v2`). Widgets are added from a picker;
`WIDGET_META` is the catalog, `WidgetContent` routes a type to its component.
Data comes from `GET /stats/overview` (which returns the full account rows,
including `type` and `groupName`) and `GET /stats/monthly`.

- **Account Group widget** (`multi: true`, so several can coexist) totals a chosen
  set of accounts. It selects **by group or by account** (`resolveGroupAccounts`):
  picking groups (`config.groupNames`, multi) is **dynamic** — an account later
  added to that group is included automatically — while picking accounts
  (`config.accountIds`) is fixed. Empty = all accounts. Group mode auto-labels the
  widget after the chosen groups until the label is edited. (v1.27.0)
- **Investments widget** (v1.27.0): total value of INVESTMENT accounts plus a value
  chart per account, reusing `GET /holdings/history` — so it covers ticker-priced
  and manually-valued (fund/pension) accounts alike. The charts the user asked
  "where do I see them" also live in the Holdings modal.
- **Other v1.27.0 widgets**: Money Lent (outstanding, from `/loans/summary`),
  Upcoming Subscriptions (active recurring by next date + a ~/month estimate),
  Savings Rate ((income−expenses)/income over the range).
- **Spending-by-Category pie is clickable (v1.32.0)**: a slice navigates to
  `/transactions?type=EXPENSE&categoryId=<id|none>`. The Transactions page seeds
  its `categoryId`/`type` filters from those query params (it already did so for
  `accountId`), so the deep link lands on that category's transactions.

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
- **"Set balance" anchors to a date.** `reconcileToBalance` stores `openingBalance` plus `openingBalanceDate` (end of today). `recalculateBalance` counts only transactions dated **after** the checkpoint, so backfilling older history never moves the balance — you set the balance *of that day*; only later transactions adjust it. A null date keeps the legacy behaviour (count everything).
- `GET /transactions?accountId=` returns the account's `openingBalance` (set via reconcile / "Set balance") so the UI can pin an "Opening balance" row at the bottom of that account's history. It is not a transaction — it stays out of income/expense — only surfaced when a single account is in view.
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

## Mobile / responsive (v1.28.0)

The UI is inline-style-heavy, and inline styles beat media queries — so the
layout-critical sizing was moved into CSS classes in `index.css` that a
`@media (max-width: 768px)` block can override:

- `.sidebar` / `.main-content` / `.mobile-topbar` / `.sidebar-backdrop`: on desktop
  the sidebar is the fixed 220px rail; on mobile it becomes an off-canvas drawer
  (translateX) toggled by a hamburger in a fixed top bar, with a tap-to-close
  backdrop. `Layout.jsx` holds the open/close state and closes on nav. Don't put
  width/position/margin back inline on these — it would defeat the media query.
- `.dashboard-grid` replaces the inline `grid-template-columns: repeat(12,1fr)` on
  the dashboard grid; on mobile it collapses to one column and forces every widget
  `grid-column: 1 / -1 !important` (overriding each cell's inline span).
- Wide tables scroll in their own box: the Transactions table is wrapped in
  `.scroll-x` with a `minWidth`, and the modal tables (holdings, trades, loan
  payments, AI review) got `overflowX: auto` + a table `minWidth`. `body` is
  `overflow-x: hidden` on mobile so nothing bleeds past the viewport.
- `index.html` carries the viewport meta (already present) plus `theme-color`.
- Inputs are `font-size: 16px` on mobile so iOS Safari doesn't zoom in on focus.

**Add/Edit transaction wizard (v1.31.0).** The old single dense form became a
4-step wizard in `Transactions.jsx` (`step` state, `STEP_TITLES`, `stepValid` /
`stepMsg` / `goNext` / `goBack`): **0 Type · 1 Amount & date · 2 Account(s) ·
3 Details** (description, category with "+ New", subscription toggle, notes).
`.tx-wizard` is a centered ~500px card on desktop and **full-screen on mobile**
(100dvh, no radius); `.tx-wizard-body` scrolls. Each step gates Next with
`stepValid`; the investment-account block and "switch to transfer" live on step 2;
`save()` still does the final full validation. All prior behaviour is preserved
(remembered account, inline category, subscription, edit mode → "Save changes").

## Conventions

- Route files each instantiate their own `PrismaClient` (existing pattern).
- Secrets live in the `Settings` singleton row; `/config` exposes only booleans like
  `hasCustomJwtSecret`, never secret values.
- Cron jobs live in `src/index.js` (recurring processing daily; backup at 02:00).
