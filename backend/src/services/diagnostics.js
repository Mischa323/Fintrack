const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Read-only diagnostics for "the import doesn't add up". Nothing here writes:
// balances are recomputed in memory and compared with what is stored, so the
// report shows *why* a number is off instead of silently fixing it.

const round = (n) => Math.round(n * 100) / 100;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;
const normDesc = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const sourceOf = (t) => t.importedFrom || "manual";

async function loadAll() {
  const [accounts, transactions, holdings] = await Promise.all([
    prisma.account.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.transaction.findMany({
      select: {
        id: true, accountId: true, toAccountId: true, categoryId: true, amount: true,
        description: true, date: true, type: true, importedFrom: true, externalId: true,
        counterpartyIban: true, createdAt: true, notes: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.holding.findMany({ select: { accountId: true, symbol: true, quantity: true, lastPrice: true, currency: true } }),
  ]);
  for (const t of transactions) t.amount = Number(t.amount);
  return { accounts, transactions, holdings };
}

// Effect of one transaction on one account — mirrors sumTransactions in
// services/accountBalance.js (a transfer's incoming side is via toAccountId).
function effectOn(t, accountId) {
  if (t.toAccountId === accountId) return t.amount;
  if (t.accountId !== accountId) return 0;
  if (t.type === "INCOME") return t.amount;
  return -t.amount; // expense, or a transfer leaving this account
}

function accountSummaries({ accounts, transactions, holdings }) {
  const now = Date.now();
  return accounts.map((a) => {
    const rows = transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id);
    const anchor = a.openingBalanceDate ? new Date(a.openingBalanceDate).getTime() : null;

    let counted = 0, countedN = 0, excluded = 0, excludedN = 0;
    let income = 0, expense = 0, transferOut = 0, transferIn = 0;
    const bySource = {};
    const byType = {};
    let negative = 0, zero = 0, future = 0, transferNoTarget = 0, uncategorized = 0;
    let minDate = null, maxDate = null;

    for (const t of rows) {
      const eff = effectOn(t, a.id);
      const ts = new Date(t.date).getTime();
      if (anchor !== null && ts <= anchor) { excluded += eff; excludedN++; }
      else { counted += eff; countedN++; }

      if (t.toAccountId === a.id) transferIn += t.amount;
      else if (t.type === "INCOME") income += t.amount;
      else if (t.type === "EXPENSE") expense += t.amount;
      else if (t.type === "TRANSFER") transferOut += t.amount;

      if (t.accountId === a.id) {
        bySource[sourceOf(t)] = (bySource[sourceOf(t)] || 0) + 1;
        byType[t.type] = (byType[t.type] || 0) + 1;
        if (t.amount < 0) negative++;
        if (t.amount === 0) zero++;
        if (ts > now + DAY) future++;
        if (t.type === "TRANSFER" && !t.toAccountId) transferNoTarget++;
        if (t.type !== "TRANSFER" && !t.categoryId) uncategorized++;
      }
      if (!minDate || ts < minDate) minDate = ts;
      if (!maxDate || ts > maxDate) maxDate = ts;
    }

    const stored = Number(a.balance);
    const opening = Number(a.openingBalance);
    const summary = {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      iban: a.iban,
      groupName: a.groupName,
      storedBalance: round(stored),
      openingBalance: round(opening),
      openingBalanceDate: a.openingBalanceDate,
      transactions: rows.length,
      ownRows: Object.values(bySource).reduce((s, n) => s + n, 0),
      incomingTransfers: rows.filter((t) => t.toAccountId === a.id).length,
      bySource,
      byType,
      dateRange: rows.length ? { from: dayKey(minDate), to: dayKey(maxDate) } : null,
      totals: { income: round(income), expense: round(expense), transferOut: round(transferOut), transferIn: round(transferIn) },
      anomalies: { negativeAmounts: negative, zeroAmounts: zero, futureDated: future, transfersWithoutTarget: transferNoTarget, uncategorized },
    };

    if (a.type === "INVESTMENT") {
      const own = holdings.filter((h) => h.accountId === a.id);
      const byCurrency = {};
      for (const h of own) {
        if (h.lastPrice == null) continue;
        byCurrency[h.currency] = round((byCurrency[h.currency] || 0) + Number(h.quantity) * Number(h.lastPrice));
      }
      summary.investment = {
        manualValue: a.manualValue == null ? null : Number(a.manualValue),
        holdings: own.length,
        holdingsValueByCurrency: byCurrency,
        note: "Balance is derived from holdings (+ manual value), not from transactions.",
      };
    } else {
      summary.balanceCheck = {
        countedMovements: round(counted),
        countedRows: countedN,
        excludedBeforeAnchor: round(excluded),
        excludedRows: excludedN,
        recomputedBalance: round(opening + counted),
        drift: round(stored - (opening + counted)),
        everythingSummed: round(opening + counted + excluded),
      };
    }
    return summary;
  });
}

// Same account, same day, same amount, same type, same text → probably imported twice.
function exactDuplicates(transactions, accountId) {
  const groups = new Map();
  for (const t of transactions) {
    if (accountId && t.accountId !== accountId) continue;
    const key = [t.accountId, dayKey(t.date), t.amount.toFixed(2), t.type, normDesc(t.description)].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => ({
    accountId: g[0].accountId,
    date: dayKey(g[0].date),
    amount: g[0].amount,
    type: g[0].type,
    description: g[0].description,
    count: g.length,
    sources: [...new Set(g.map(sourceOf))],
    ids: g.map((t) => ({ id: t.id, externalId: t.externalId, source: sourceOf(t), createdAt: t.createdAt })),
  }));
}

// Same account, amount and type from two *different* import sources within two
// days — e.g. a Maybe CSV and a CAMT statement covering the same period, where
// booking date and value date differ by a day and the descriptions differ.
function crossSourceDuplicates(transactions, accountId) {
  const buckets = new Map();
  for (const t of transactions) {
    if (accountId && t.accountId !== accountId) continue;
    const key = [t.accountId, t.amount.toFixed(2), t.type].join("|");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  const pairs = [];
  const used = new Set();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => new Date(x.date) - new Date(y.date));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (used.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (new Date(b.date) - new Date(a.date) > 2 * DAY) break;
        if (used.has(b.id) || sourceOf(a) === sourceOf(b)) continue;
        used.add(a.id); used.add(b.id);
        pairs.push({
          accountId: a.accountId,
          amount: a.amount,
          type: a.type,
          a: { id: a.id, date: dayKey(a.date), description: a.description, source: sourceOf(a), externalId: a.externalId },
          b: { id: b.id, date: dayKey(b.date), description: b.description, source: sourceOf(b), externalId: b.externalId },
        });
        break;
      }
    }
  }
  return pairs;
}

// An EXPENSE on one own account and an INCOME of the same amount on another
// within ±4 days: a transfer stored as two loose rows, so it inflates both
// income and expense. "iban" strength = one side names the other's IBAN.
function unlinkedTransfers({ accounts, transactions }) {
  const ibanOf = new Map(accounts.filter((a) => a.iban).map((a) => [a.id, a.iban.replace(/\s/g, "").toUpperCase()]));
  const norm = (s) => (s ? String(s).replace(/\s/g, "").toUpperCase() : null);
  const incomes = new Map();
  for (const t of transactions) {
    if (t.type !== "INCOME") continue;
    const k = t.amount.toFixed(2);
    if (!incomes.has(k)) incomes.set(k, []);
    incomes.get(k).push(t);
  }
  const used = new Set();
  const pairs = [];
  for (const out of transactions) {
    if (out.type !== "EXPENSE") continue;
    const candidates = incomes.get(out.amount.toFixed(2)) || [];
    let best = null;
    for (const inc of candidates) {
      if (used.has(inc.id) || inc.accountId === out.accountId) continue;
      const gap = Math.abs(new Date(inc.date) - new Date(out.date));
      if (gap > 4 * DAY) continue;
      const ibanMatch = norm(out.counterpartyIban) === ibanOf.get(inc.accountId)
        || norm(inc.counterpartyIban) === ibanOf.get(out.accountId);
      const score = (ibanMatch ? 10 : 0) - gap / DAY;
      if (!best || score > best.score) best = { inc, score, ibanMatch };
    }
    if (best) {
      used.add(best.inc.id);
      pairs.push({
        amount: out.amount,
        strength: best.ibanMatch ? "iban" : "amount+date",
        out: { id: out.id, accountId: out.accountId, date: dayKey(out.date), description: out.description, source: sourceOf(out) },
        in: { id: best.inc.id, accountId: best.inc.accountId, date: dayKey(best.inc.date), description: best.inc.description, source: sourceOf(best.inc) },
      });
    }
  }
  return pairs;
}

// Rows created close together by the same source on the same account are one
// import run; a gap of more than five minutes starts a new one.
function importBatches(transactions, accountId) {
  const groups = new Map();
  for (const t of transactions) {
    if (accountId && t.accountId !== accountId) continue;
    const key = `${t.accountId}|${sourceOf(t)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const batches = [];
  for (const list of groups.values()) {
    list.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    let cur = null;
    for (const t of list) {
      const at = new Date(t.createdAt).getTime();
      if (!cur || at - cur.last > 5 * 60 * 1000) {
        cur = { accountId: t.accountId, source: sourceOf(t), importedAt: t.createdAt, last: at, rows: 0, from: null, to: null, income: 0, expense: 0, transfers: 0 };
        batches.push(cur);
      }
      cur.last = at;
      cur.rows++;
      const d = dayKey(t.date);
      if (!cur.from || d < cur.from) cur.from = d;
      if (!cur.to || d > cur.to) cur.to = d;
      if (t.type === "INCOME") cur.income += t.amount;
      else if (t.type === "EXPENSE") cur.expense += t.amount;
      else cur.transfers++;
    }
  }
  return batches
    .map(({ last, ...b }) => ({ ...b, income: round(b.income), expense: round(b.expense) }))
    .sort((x, y) => new Date(y.importedAt) - new Date(x.importedAt));
}

// Turn the numbers into plain-language findings, worst first.
function findings(summaries, dupes, cross, transfers) {
  const out = [];
  const nameOf = new Map(summaries.map((s) => [s.id, s.name]));
  for (const s of summaries) {
    const bc = s.balanceCheck;
    if (bc && Math.abs(bc.drift) >= 0.01) {
      out.push({ severity: "high", account: s.name, issue: "balance-drift",
        detail: `Stored balance ${s.storedBalance} ≠ recomputed ${bc.recomputedBalance} (drift ${bc.drift}). The ↻ button on the account would correct it.` });
    }
    if (bc && bc.excludedRows > 0) {
      out.push({ severity: "info", account: s.name, issue: "before-anchor",
        detail: `${bc.excludedRows} transactions dated on/before the "Set balance" checkpoint (${dayKey(s.openingBalanceDate)}) don't move the balance (sum ${bc.excludedBeforeAnchor}). Expected if they were already included in the balance you set.` });
    }
    const an = s.anomalies;
    if (an.negativeAmounts) out.push({ severity: "high", account: s.name, issue: "negative-amounts", detail: `${an.negativeAmounts} rows have a negative amount; amounts should be positive with the sign in the type.` });
    if (an.transfersWithoutTarget) out.push({ severity: "medium", account: s.name, issue: "transfer-without-target", detail: `${an.transfersWithoutTarget} transfers have no destination account — the money leaves and lands nowhere.` });
    if (an.futureDated) out.push({ severity: "medium", account: s.name, issue: "future-dated", detail: `${an.futureDated} rows are dated in the future.` });
  }
  const dupByAcc = {};
  for (const d of dupes) dupByAcc[d.accountId] = (dupByAcc[d.accountId] || 0) + d.count - 1;
  for (const [id, n] of Object.entries(dupByAcc)) {
    out.push({ severity: "high", account: nameOf.get(id), issue: "exact-duplicates", detail: `${n} extra rows share date, amount, type and description with another row (possible double import — or genuinely identical purchases).` });
  }
  const crossByAcc = {};
  for (const p of cross) crossByAcc[p.accountId] = (crossByAcc[p.accountId] || 0) + 1;
  for (const [id, n] of Object.entries(crossByAcc)) {
    out.push({ severity: "high", account: nameOf.get(id), issue: "cross-source-duplicates", detail: `${n} rows have a twin from a different import source (same amount, ≤2 days apart) — usually the same period imported twice from two formats.` });
  }
  if (transfers.length) {
    const strong = transfers.filter((t) => t.strength === "iban").length;
    out.push({ severity: "medium", account: null, issue: "unlinked-transfers", detail: `${transfers.length} expense/income pairs between your own accounts look like transfers (${strong} confirmed by IBAN). They inflate both income and expense totals.` });
  }
  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

async function buildReport({ accountId, limit = 200 } = {}) {
  const data = await loadAll();
  const summaries = accountSummaries(data);
  const dupes = exactDuplicates(data.transactions, accountId);
  const cross = crossSourceDuplicates(data.transactions, accountId);
  const transfers = unlinkedTransfers(data);
  return {
    generatedAt: new Date().toISOString(),
    counts: { accounts: data.accounts.length, transactions: data.transactions.length },
    findings: findings(summaries, dupes, cross, transfers),
    accounts: accountId ? summaries.filter((s) => s.id === accountId) : summaries,
    imports: importBatches(data.transactions, accountId),
    duplicates: dupes.slice(0, limit),
    crossSourceDuplicates: cross.slice(0, limit),
    unlinkedTransfers: transfers.slice(0, limit),
  };
}

module.exports = {
  loadAll, accountSummaries, exactDuplicates, crossSourceDuplicates,
  unlinkedTransfers, importBatches, findings, buildReport,
};
