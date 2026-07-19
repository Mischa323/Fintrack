const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Market prices for investment holdings.
//
// No broker offers an API for personal accounts, so FinTrack never learns which
// shares you own — you enter or import those. What it can do automatically is
// keep their prices current, which is what actually changes day to day.
//
// The quote source is deliberately isolated in fetchQuote(): it is an
// unofficial endpoint, so if it ever breaks only this one function changes.

const QUOTE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const FX_URL = "https://api.frankfurter.app/latest";
const REQUEST_TIMEOUT_MS = 10000;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Returns { price, currency, name } for a ticker.
async function fetchQuote(symbol) {
  const url = `${QUOTE_URL}${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const data = await getJson(url);
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (meta == null || typeof price !== "number") {
    throw new Error(`No price returned for "${symbol}"`);
  }
  return {
    price,
    currency: meta.currency || "USD",
    name: meta.longName || meta.shortName || null,
  };
}

// Exchange rates are shared across holdings, so they are fetched once per run.
async function makeRateResolver() {
  const cache = new Map();
  return async function rate(from, to) {
    if (!from || !to || from === to) return 1;
    const key = `${from}>${to}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const data = await getJson(`${FX_URL}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const value = data?.rates?.[to];
      if (typeof value !== "number") throw new Error("rate missing");
      cache.set(key, value);
      return value;
    } catch {
      // Better to value at 1:1 and flag it than to crash the whole refresh
      cache.set(key, null);
      return null;
    }
  };
}

// Refreshes prices for every holding and rewrites the balance of each
// investment account to the value of what it holds.
async function refreshHoldings(accountId = null) {
  const where = accountId ? { accountId } : {};
  const holdings = await prisma.holding.findMany({
    where,
    include: { account: { select: { id: true, currency: true } } },
  });
  if (holdings.length === 0) return { updated: 0, failed: 0, accounts: 0, errors: [] };

  const rate = await makeRateResolver();
  const errors = [];
  let updated = 0;

  for (const holding of holdings) {
    try {
      const quote = await fetchQuote(holding.symbol);
      await prisma.holding.update({
        where: { id: holding.id },
        data: {
          lastPrice: quote.price,
          lastPriceAt: new Date(),
          currency: quote.currency,
          name: holding.name || quote.name,
        },
      });
      updated++;
    } catch (err) {
      errors.push(`${holding.symbol}: ${err.message}`);
    }
  }

  // Recompute account balances from the refreshed prices
  const accountIds = [...new Set(holdings.map((h) => h.accountId))];
  for (const id of accountIds) {
    await recalculateAccountValue(id, rate);
  }

  return {
    updated,
    failed: errors.length,
    accounts: accountIds.length,
    errors: errors.slice(0, 10),
  };
}

// Sets an account's balance to the summed value of its holdings, converted into
// the account's own currency. Positions whose rate could not be fetched are
// counted unconverted rather than dropped, and reported.
async function recalculateAccountValue(accountId, rate) {
  const resolve = rate || (await makeRateResolver());
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, currency: true },
  });
  if (!account) return null;

  const holdings = await prisma.holding.findMany({ where: { accountId } });
  let total = 0;
  let unconverted = 0;

  for (const h of holdings) {
    if (h.lastPrice == null) continue;
    const value = Number(h.quantity) * Number(h.lastPrice);
    const fx = await resolve(h.currency, account.currency || "EUR");
    if (fx == null) {
      unconverted++;
      total += value;
    } else {
      total += value * fx;
    }
  }

  const balance = Math.round(total * 100) / 100;
  await prisma.account.update({ where: { id: accountId }, data: { balance } });
  return { balance, unconverted };
}

module.exports = { fetchQuote, refreshHoldings, recalculateAccountValue };
