const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Reconstructs what an investment account was worth over time.
//
// The value on any past day is Σ (quantity held that day × close price that day
// × FX that day). Quantity comes from replaying the trade ledger up to that day,
// the close from the quote provider's history, and FX from ECB history. It is
// therefore an actual reconstruction, not forward-only snapshots — the chart has
// history the moment a position exists.

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const FX_RANGE_URL = "https://api.frankfurter.app";
const RANGES = { "1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "1y": "1y", "2y": "2y", max: "max" };
const RANGE_MONTHS = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "2y": 24, max: 1200 };

// The manually-tracked value chart is built from stored snapshots, not prices.
function rangeStart(range) {
  const months = RANGE_MONTHS[range] || 6;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

async function snapshotHistory(accountId, range, currency) {
  const snapshots = await prisma.accountValueSnapshot.findMany({
    where: { accountId, date: { gte: rangeStart(range) } },
    orderBy: { date: "asc" },
  });
  return {
    series: snapshots.map((s) => ({ date: dayKey(s.date), value: Number(s.value) })),
    currency,
    errors: [],
  };
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// Daily closes for one symbol as a Map of YYYY-MM-DD -> price, plus its currency.
async function fetchPriceHistory(symbol, range) {
  const data = await getJson(`${CHART_URL}${encodeURIComponent(symbol)}?interval=1d&range=${range}`);
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const byDay = new Map();
  let lastClose = null;
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close === "number") lastClose = close;
    if (lastClose != null) byDay.set(dayKey(timestamps[i] * 1000), lastClose);
  }
  return { byDay, currency: result?.meta?.currency || "USD" };
}

// Daily FX rate from -> to as a Map of YYYY-MM-DD -> rate over [start, end].
async function fetchFxHistory(from, to, start, end) {
  if (from === to) return new Map();
  const data = await getJson(`${FX_RANGE_URL}/${start}..${end}?from=${from}&to=${to}`);
  const byDay = new Map();
  for (const [day, rates] of Object.entries(data?.rates || {})) {
    if (typeof rates?.[to] === "number") byDay.set(day, rates[to]);
  }
  return byDay;
}

// Nearest rate on or before a day, so weekends and holidays carry forward.
function rateOnOrBefore(byDay, day) {
  if (byDay.size === 0) return 1;
  if (byDay.has(day)) return byDay.get(day);
  let best = null;
  for (const [d, r] of byDay) if (d <= day && (best === null || d > best.d)) best = { d, r };
  return best ? best.r : [...byDay.values()][0];
}

// Quantity of a holding on a given day.
//
// With recorded trades, replay those dated on or before the day — the position
// appears from its opening date and each buy/sell adjusts it. With no trades
// (an imported position), the real purchase dates are unknown, so the current
// quantity is assumed to have been held throughout: the chart then shows how
// what you hold now has moved in value, which is what the user asked to see.
function quantityOnDay(holding, day) {
  if (!holding.trades || holding.trades.length === 0) return Number(holding.quantity);
  let qty = 0;
  for (const t of holding.trades) {
    if (dayKey(t.date) > day) continue;
    qty += t.kind === "SELL" ? -Number(t.quantity) : Number(t.quantity);
  }
  return Math.max(0, qty);
}

async function accountValueHistory(accountId, range = "6mo") {
  const yahooRange = RANGES[range] || "6mo";
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { currency: true },
  });
  if (!account) return { series: [], errors: ["Account not found"] };

  const accountCurrency = account.currency || "EUR";

  const holdings = await prisma.holding.findMany({
    where: { accountId },
    include: { trades: { orderBy: [{ opening: "desc" }, { date: "asc" }] } },
  });
  // No priced holdings: this is a manually-valued account (a fund or pension), so
  // its chart comes from the snapshots recorded each time its value was entered.
  if (holdings.length === 0) return snapshotHistory(accountId, range, accountCurrency);
  const errors = [];

  // Price history per symbol; the union of trading days is the chart's axis.
  const priceBySymbol = new Map();
  const allDays = new Set();
  for (const h of holdings) {
    try {
      const { byDay, currency } = await fetchPriceHistory(h.symbol, yahooRange);
      priceBySymbol.set(h.id, { byDay, currency });
      for (const d of byDay.keys()) allDays.add(d);
    } catch {
      errors.push(`No price history for ${h.symbol}`);
    }
  }
  if (allDays.size === 0) return { series: [], errors };

  const days = [...allDays].sort();
  const start = days[0];
  const end = days[days.length - 1];

  // FX history per foreign currency, fetched once.
  const fxByCurrency = new Map();
  for (const { currency } of priceBySymbol.values()) {
    if (currency === accountCurrency || fxByCurrency.has(currency)) continue;
    try {
      fxByCurrency.set(currency, await fetchFxHistory(currency, accountCurrency, start, end));
    } catch {
      fxByCurrency.set(currency, new Map()); // valued unconverted, better than a gap
      errors.push(`No FX history for ${currency}`);
    }
  }

  // Walk the shared axis carrying each symbol's last close forward, so a day one
  // market is closed (a US holiday, or Amsterdam's) does not drop that holding to
  // zero and make the line zigzag. A symbol contributes nothing before its first
  // close, which is correct — there is no price to value it at yet.
  const lastClose = new Map();
  const series = days.map((day) => {
    let value = 0;
    for (const h of holdings) {
      const price = priceBySymbol.get(h.id);
      if (!price) continue;
      const close = price.byDay.get(day);
      if (close != null) lastClose.set(h.id, close);
      const carried = lastClose.get(h.id);
      if (carried == null) continue;
      const qty = quantityOnDay(h, day);
      if (qty <= 0) continue;
      const fx = price.currency === accountCurrency ? 1 : rateOnOrBefore(fxByCurrency.get(price.currency) || new Map(), day);
      value += qty * carried * fx;
    }
    return { date: day, value: Math.round(value * 100) / 100 };
  });

  return { series, currency: accountCurrency, errors: errors.slice(0, 5) };
}

module.exports = { accountValueHistory };
