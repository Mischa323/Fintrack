# FinTrack — Personal Finance Tracker

A self-hosted finance tracker with a liquid glass UI, multi-account support, recurring transactions, categories, and Maybe Finance import.

## Quick Start with Portainer

1. **Copy the env file**
   ```bash
   cp .env.example .env
   # No credentials needed — uses SQLite (like the dmarc-dashboard project)
   ```

2. **Deploy via Portainer**
   - Open Portainer → Stacks → Add Stack
   - Paste the contents of `docker-compose.yml`
   - Set environment variables from `.env`
   - Deploy

3. **Access the app** at `http://your-server:8080`

## Local Development

### Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
node prisma/seed.js      # optional: seed default categories
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Backend runs on `:3001`, frontend on `:5173` (proxied to backend via Vite).

## Features

- **Multiple accounts** — checking, savings, credit cards, investments, cash
- **Transactions** — with search, filters, pagination, category assignment
- **Categories** — with sub-categories, icons, and colors
- **Recurring transactions** — daily/weekly/biweekly/monthly/quarterly/yearly with pause/resume
- **Dashboard** — balance overview, income vs expenses chart, category pie chart
- **Import** — Maybe Finance CSV and generic bank CSV (auto-detects Dutch/English columns)

## Importing from Maybe Finance

1. In Maybe Finance go to **Settings → Export → Transactions CSV**
2. Select the account and date range and download
3. In FinTrack go to **Import**, select *Maybe Finance* mode
4. Choose the target account and upload the CSV

Duplicate detection uses the `id` field from Maybe exports — re-importing the same file is safe.

## Tech Stack

| Layer     | Tech                                |
|-----------|-------------------------------------|
| Frontend  | React 18, Vite, Recharts, Tailwind  |
| Backend   | Node.js, Express, Prisma ORM        |
| Database  | SQLite (via Prisma ORM)             |
| Proxy     | Nginx                               |
| Container | Docker / Portainer                  |

## Environment Variables

| Variable       | Default                       | Description                         |
|----------------|-------------------------------|-------------------------------------|
| `DATABASE_URL` | `file:/app/data/finance.db`   | SQLite file path (inside container) |
| `PORT`         | `8080`                        | Exposed host port                   |
