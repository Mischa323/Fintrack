const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { parse } = require("csv-parse");
const { PrismaClient } = require("@prisma/client");
const { fetchQuote, refreshHoldings, recalculateAccountValue } = require("../services/quotes");

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ dest: path.join(__dirname, "../../uploads") });

// GET /holdings?accountId=
router.get("/", async (req, res) => {
  const { accountId } = req.query;
  const holdings = await prisma.holding.findMany({
    where: accountId ? { accountId } : {},
    orderBy: { symbol: "asc" },
    include: { account: { select: { id: true, name: true, currency: true } } },
  });
  res.json(holdings);
});

// POST /holdings — add a position by hand
router.post("/", async (req, res) => {
  const { accountId, symbol, quantity, avgCost, name } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  if (quantity === undefined || Number(quantity) <= 0) {
    return res.status(400).json({ error: "Enter a quantity greater than zero" });
  }

  const ticker = String(symbol).trim().toUpperCase();

  // Look the price up straight away: it validates the ticker and fills in the
  // name and currency, so a typo is caught here instead of silently sitting at
  // zero value until the next scheduled refresh.
  let quote = null;
  try {
    quote = await fetchQuote(ticker);
  } catch {
    return res.status(400).json({
      error: `No price found for "${ticker}". European tickers usually need a suffix, e.g. ASML.AS or SHELL.AS.`,
    });
  }

  const holding = await prisma.holding.create({
    data: {
      accountId,
      symbol: ticker,
      name: name || quote.name,
      quantity: Number(quantity),
      avgCost: avgCost === undefined || avgCost === "" ? null : Number(avgCost),
      currency: quote.currency,
      lastPrice: quote.price,
      lastPriceAt: new Date(),
    },
  });

  await recalculateAccountValue(accountId);
  res.status(201).json(holding);
});

router.put("/:id", async (req, res) => {
  const { quantity, avgCost, name, symbol } = req.body;
  const data = {};
  if (quantity !== undefined) data.quantity = Number(quantity);
  if (avgCost !== undefined) data.avgCost = avgCost === "" ? null : Number(avgCost);
  if (name !== undefined) data.name = name || null;

  // Imported tickers do not always match a tradeable symbol (Maybe exports
  // "REINMETHAL" for Rheinmetall), so the symbol can be corrected and the price
  // is looked up again straight away.
  if (symbol) {
    const ticker = String(symbol).trim().toUpperCase();
    try {
      const quote = await fetchQuote(ticker);
      data.symbol = ticker;
      data.currency = quote.currency;
      data.lastPrice = quote.price;
      data.lastPriceAt = new Date();
      if (!name) data.name = quote.name;
    } catch {
      return res.status(400).json({
        error: `No price found for "${ticker}". European listings usually need a suffix, e.g. ASML.AS, RHM.DE, MC.PA.`,
      });
    }
  }

  const holding = await prisma.holding.update({ where: { id: req.params.id }, data });
  await recalculateAccountValue(holding.accountId);
  res.json(holding);
});

router.delete("/:id", async (req, res) => {
  const holding = await prisma.holding.delete({ where: { id: req.params.id } });
  await recalculateAccountValue(holding.accountId);
  res.status(204).end();
});

// POST /holdings/refresh — fetch fresh prices now
router.post("/refresh", async (req, res) => {
  const { accountId } = req.body || {};
  res.json(await refreshHoldings(accountId || null));
});

// ── Revolut investment statement ─────────────────────────────────────────────
// Revolut exports trades, not positions, so positions are derived: buys and
// sells are netted per ticker and the average cost is weighted across buys.

function pickColumn(row, names) {
  const keys = Object.keys(row);
  for (const wanted of names) {
    const key = keys.find((k) => k.toLowerCase().replace(/[^a-z]/g, "").includes(wanted));
    if (key) return row[key];
  }
  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  // Strips currency symbols and thousands separators: "$1,234.56" -> 1234.56
  const cleaned = String(value).replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "");
  return parseFloat(cleaned.replace(",", "."));
}

function aggregateRevolutTrades(rows) {
  const positions = new Map();
  let buys = 0;
  let sells = 0;
  let ignored = 0;

  for (const row of rows) {
    const ticker = (pickColumn(row, ["ticker", "symbol"]) || "").trim().toUpperCase();
    const type = String(pickColumn(row, ["type"]) || "").toUpperCase();
    if (!ticker) { ignored++; continue; }

    const isBuy = type.includes("BUY");
    const isSell = type.includes("SELL");
    if (!isBuy && !isSell) { ignored++; continue; } // dividends, fees, top-ups

    const quantity = Math.abs(parseNumber(pickColumn(row, ["quantity", "shares"])));
    const price = Math.abs(parseNumber(pickColumn(row, ["pricepershare", "price"])));
    if (!Number.isFinite(quantity) || quantity === 0) { ignored++; continue; }

    const currency = String(pickColumn(row, ["currency"]) || "USD").trim().toUpperCase();
    const entry = positions.get(ticker) || { symbol: ticker, quantity: 0, cost: 0, currency };

    if (isBuy) {
      entry.quantity += quantity;
      if (Number.isFinite(price)) entry.cost += quantity * price;
      buys++;
    } else {
      // Selling leaves the average cost per share unchanged
      const avg = entry.quantity > 0 ? entry.cost / entry.quantity : 0;
      entry.quantity -= quantity;
      entry.cost = Math.max(0, entry.cost - quantity * avg);
      sells++;
    }
    positions.set(ticker, entry);
  }

  const result = [];
  for (const entry of positions.values()) {
    // Rounded: repeated fractional trades leave tiny residues like 1e-9
    const quantity = Math.round(entry.quantity * 1e8) / 1e8;
    if (quantity <= 0) continue; // fully sold
    result.push({
      symbol: entry.symbol,
      quantity,
      avgCost: entry.cost > 0 ? entry.cost / quantity : null,
      currency: entry.currency,
    });
  }
  return { positions: result, buys, sells, ignored };
}

router.post("/import/revolut", upload.single("file"), async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  let rows;
  try {
    const content = fs.readFileSync(req.file.path, "utf8");
    rows = await new Promise((resolve, reject) => {
      parse(content, { columns: true, skip_empty_lines: true, trim: true }, (err, records) =>
        err ? reject(err) : resolve(records)
      );
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not read the CSV: ${err.message}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }

  const { positions, buys, sells, ignored } = aggregateRevolutTrades(rows);
  if (positions.length === 0) {
    return res.status(400).json({
      error: "No buy or sell rows found. Export the Stocks account statement from Revolut "
        + `(the file must contain Ticker, Type and Quantity columns). Columns seen: ${Object.keys(rows[0] || {}).join(", ") || "none"}`,
    });
  }

  const imported = [];
  const errors = [];
  for (const p of positions) {
    try {
      const quote = await fetchQuote(p.symbol).catch(() => null);
      await prisma.holding.upsert({
        where: { accountId_symbol: { accountId, symbol: p.symbol } },
        update: {
          quantity: p.quantity,
          avgCost: p.avgCost,
          ...(quote ? { currency: quote.currency, lastPrice: quote.price, lastPriceAt: new Date(), name: quote.name } : {}),
        },
        create: {
          accountId,
          symbol: p.symbol,
          quantity: p.quantity,
          avgCost: p.avgCost,
          currency: quote?.currency || p.currency,
          name: quote?.name || null,
          lastPrice: quote?.price ?? null,
          lastPriceAt: quote ? new Date() : null,
        },
      });
      imported.push({ symbol: p.symbol, quantity: p.quantity, priced: !!quote });
      if (!quote) errors.push(`${p.symbol}: no price found, position saved without a value`);
    } catch (err) {
      errors.push(`${p.symbol}: ${err.message}`);
    }
  }

  await recalculateAccountValue(accountId);
  res.json({ imported: imported.length, positions: imported, buys, sells, ignored, errors: errors.slice(0, 10) });
});

// ── Maybe Finance trades.csv ─────────────────────────────────────────────────
// Columns: date, account_name, ticker, quantity, price, amount, currency.
// Like the Revolut export it lists trades, so positions are derived by netting
// per account and ticker. Account names are matched the way the transaction
// import does, so one file can fill several investment accounts at once.
router.post("/import/trades", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  let rows;
  try {
    const content = fs.readFileSync(req.file.path, "utf8");
    rows = await new Promise((resolve, reject) => {
      parse(content, { columns: true, skip_empty_lines: true, trim: true }, (err, records) =>
        err ? reject(err) : resolve(records)
      );
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not read the CSV: ${err.message}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }

  const accounts = await prisma.account.findMany({ select: { id: true, name: true } });
  const byName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]));

  // account id -> ticker -> { quantity, cost, currency }
  const perAccount = new Map();
  const unknownAccounts = new Set();
  let ignored = 0;

  for (const row of rows) {
    const accountName = (pickColumn(row, ["accountname", "account"]) || "").trim();
    const ticker = (pickColumn(row, ["ticker", "symbol"]) || "").trim().toUpperCase();
    const quantity = parseNumber(pickColumn(row, ["quantity", "shares"]));
    const price = parseNumber(pickColumn(row, ["priceper", "price"]));
    if (!ticker || !Number.isFinite(quantity) || quantity === 0) { ignored++; continue; }

    const account = byName.get(accountName.toLowerCase());
    if (!account) { unknownAccounts.add(accountName || "(no name)"); ignored++; continue; }

    const currency = String(pickColumn(row, ["currency"]) || "USD").trim().toUpperCase();
    const tickers = perAccount.get(account.id) || new Map();
    const entry = tickers.get(ticker) || { quantity: 0, cost: 0, currency };
    entry.quantity += quantity; // sells appear as negative quantities
    if (Number.isFinite(price)) entry.cost += quantity * price;
    tickers.set(ticker, entry);
    perAccount.set(account.id, tickers);
  }

  const imported = [];
  const withoutPrice = [];
  for (const [accountId, tickers] of perAccount) {
    for (const [symbol, entry] of tickers) {
      const quantity = Math.round(entry.quantity * 1e8) / 1e8;
      if (quantity <= 0) continue;
      const quote = await fetchQuote(symbol).catch(() => null);
      await prisma.holding.upsert({
        where: { accountId_symbol: { accountId, symbol } },
        update: {
          quantity,
          avgCost: entry.cost > 0 ? entry.cost / quantity : null,
          ...(quote ? { currency: quote.currency, lastPrice: quote.price, lastPriceAt: new Date(), name: quote.name } : {}),
        },
        create: {
          accountId, symbol, quantity,
          avgCost: entry.cost > 0 ? entry.cost / quantity : null,
          currency: quote?.currency || entry.currency,
          name: quote?.name || null,
          lastPrice: quote?.price ?? null,
          lastPriceAt: quote ? new Date() : null,
        },
      });
      imported.push({ symbol, quantity, priced: !!quote });
      if (!quote) withoutPrice.push(symbol);
    }
    await recalculateAccountValue(accountId);
  }

  res.json({
    imported: imported.length,
    accounts: perAccount.size,
    positions: imported,
    withoutPrice,
    unknownAccounts: [...unknownAccounts],
    ignored,
    // Said plainly: an unpriced position is saved but contributes nothing until
    // its symbol is corrected to one the quote provider knows.
    note: withoutPrice.length
      ? `No price found for ${withoutPrice.join(", ")} — edit the symbol on those positions (e.g. RHM.DE for Rheinmetall, SI=F for silver).`
      : undefined,
  });
});

module.exports = router;
