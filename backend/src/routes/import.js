const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseCamt053 } = require("../services/camt053");
const { persistRows } = require("../services/importTransactions");
const { normaliseIban } = require("../services/iban");
const {
  MODES, getDefaultMode, applyAutoTransfers, findTransferCandidates, mergeCandidate,
  unlinkedCounterpartyIbans, convertCandidate,
} = require("../services/transfers");

const router = express.Router();
const prisma = new PrismaClient();

const upload = multer({ dest: path.join(__dirname, "../../uploads") });

// Parse Maybe Finance CSV export format.
// Columns vary between exports: account/account_name, and an id column that is
// often absent entirely, so every field is looked up under several names.
function maybeField(row, ...names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
}

function parseMaybeRow(row, fallbackCounter) {
  const rawAmount = parseFloat(maybeField(row, "amount", "Amount") || 0);

  // Maybe records money leaving the account as POSITIVE and money arriving as
  // negative — the opposite of what you would expect. Getting this backwards
  // turns every salary into an expense.
  const type = rawAmount > 0 ? "EXPENSE" : "INCOME";
  const amount = Math.abs(rawAmount);

  const date = new Date(maybeField(row, "date", "Date") || "");
  const description =
    maybeField(row, "name", "Name", "description", "Description") || "Imported";
  const accountName = maybeField(row, "account_name", "account", "Account", "accountName");

  let externalId = maybeField(row, "id", "Id", "ID");
  if (!externalId && fallbackCounter && !isNaN(date.getTime())) {
    // Without an id column, re-importing the same export would duplicate
    // everything. Derive a stable id from the row's own content, with an
    // occurrence counter so genuinely identical rows stay distinct.
    const basis = [
      date.toISOString().slice(0, 10),
      amount.toFixed(2),
      type,
      accountName || "",
      description,
    ].join("|");
    const seen = (fallbackCounter.get(basis) || 0) + 1;
    fallbackCounter.set(basis, seen);
    externalId = `maybe-${crypto.createHash("sha1").update(`${basis}|${seen}`).digest("hex").slice(0, 24)}`;
  }

  return {
    date,
    description,
    amount,
    type,
    categoryName: maybeField(row, "category", "Category"),
    accountName,
    notes: maybeField(row, "notes", "Notes"),
    externalId: externalId || null,
  };
}

// Parse generic bank CSV (auto-detect columns)
function parseGenericRow(row) {
  const keys = Object.keys(row).map((k) => k.toLowerCase());
  const get = (names) => {
    for (const n of names) {
      const k = keys.find((k) => k.includes(n));
      if (k) return row[Object.keys(row)[keys.indexOf(k)]];
    }
    return null;
  };

  const rawAmount = parseFloat(get(["amount", "bedrag", "value"]) || 0);
  const amount = Math.abs(rawAmount);
  const creditField = get(["credit", "bij", "af"]);
  let type = rawAmount >= 0 ? "INCOME" : "EXPENSE";
  if (creditField) type = creditField.toLowerCase().includes("bij") ? "INCOME" : "EXPENSE";

  return {
    date: new Date(get(["date", "datum", "day"]) || Date.now()),
    description: get(["description", "omschrijving", "name", "memo", "narration"]) || "Imported",
    amount,
    type,
    categoryName: get(["category", "categorie"]) || null,
    notes: get(["notes", "note", "memo", "remark"]) || null,
    externalId: get(["id", "ref", "reference"]) || null,
  };
}

// Import Maybe Finance accounts.csv to sync account balances
router.post("/maybe-accounts", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  const content = fs.readFileSync(req.file.path, "utf8");
  fs.unlinkSync(req.file.path);

  const rows = await new Promise((resolve, reject) => {
    parse(content, { columns: true, skip_empty_lines: true, trim: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  const results = [];
  for (const row of rows) {
    const name = row.name || row.Name || row.account_name || null;
    const balance = parseFloat(row.balance || row.Balance || row.current_balance || 0);
    const currency = row.currency || row.Currency || "EUR";
    if (!name || isNaN(balance)) continue;

    const existing = await prisma.account.findFirst({ where: { name } });
    if (existing) {
      await prisma.account.update({ where: { id: existing.id }, data: { balance, currency } });
      results.push({ name, balance, action: "updated" });
    } else {
      await prisma.account.create({ data: { name, balance, currency, type: "CHECKING" } });
      results.push({ name, balance, action: "created" });
    }
  }

  res.json({ accounts: results });
});

function readCsvRows(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return new Promise((resolve, reject) => {
    parse(content, { columns: true, skip_empty_lines: true, trim: true }, (err, records) =>
      err ? reject(err) : resolve(records)
    );
  });
}

function parseAll(rows, rowParser) {
  const parsed = [];
  const errors = [];
  const fallbackCounter = new Map();
  let skipped = 0;
  for (const row of rows) {
    try {
      const p = rowParser(row, fallbackCounter);
      if (isNaN(p.amount) || isNaN(p.date.getTime())) { skipped++; continue; }
      parsed.push(p);
    } catch (err) {
      errors.push(err.message);
      skipped++;
    }
  }
  return { parsed, skipped, errors };
}

const nameKey = (value) => String(value || "").trim().toLowerCase();

// A Maybe export holds every account in one file, so rows are grouped by their
// own "account" column instead of all landing in one account.
function groupByAccountName(parsedRows) {
  const groups = new Map();
  for (const row of parsedRows) {
    const key = nameKey(row.accountName);
    const group = groups.get(key) || { name: row.accountName || null, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return groups;
}

// Maybe writes both sides of an internal transfer as separate rows, named
// "Transfer to <account>" / "Transfer from <account>". Left alone they import as
// an expense AND an income, inflating both totals. Here the two legs are matched
// on the account names in their descriptions and merged into one TRANSFER row.
const TRANSFER_RE = /^\s*transfer\s+(to|from)\s+(.+?)\s*$/i;

function linkMaybeTransfers(parsedRows, accountIdByName) {
  const resolve = (name) => accountIdByName.get(nameKey(name)) || null;

  const legs = [];
  const plain = [];
  for (const row of parsedRows) {
    const match = TRANSFER_RE.exec(row.description || "");
    const ownAccount = resolve(row.accountName);
    const otherAccount = match ? resolve(match[2]) : null;
    if (!match || !ownAccount || !otherAccount || ownAccount === otherAccount) {
      plain.push(row);
      continue;
    }
    legs.push({
      row,
      outgoing: match[1].toLowerCase() === "to",
      fromId: match[1].toLowerCase() === "to" ? ownAccount : otherAccount,
      toId: match[1].toLowerCase() === "to" ? otherAccount : ownAccount,
    });
  }

  const used = new Set();
  const transfers = [];
  let paired = 0;

  for (const leg of legs) {
    if (used.has(leg)) continue;
    // The opposite leg names the same two accounts, same amount, same day
    const mirror = legs.find(
      (other) =>
        other !== leg && !used.has(other) &&
        other.outgoing !== leg.outgoing &&
        other.fromId === leg.fromId && other.toId === leg.toId &&
        Math.abs(other.row.amount - leg.row.amount) < 0.005 &&
        Math.abs(other.row.date - leg.row.date) <= 4 * 86400000
    );
    used.add(leg);
    if (mirror) { used.add(mirror); paired++; }

    const canonical = leg.outgoing ? leg : mirror || leg;
    // Both legs derive the same id, so re-importing skips instead of duplicating
    const basis = [
      canonical.row.date.toISOString().slice(0, 10),
      canonical.row.amount.toFixed(2),
      leg.fromId,
      leg.toId,
    ].join("|");
    transfers.push({
      ...canonical.row,
      type: "TRANSFER",
      transferFromAccountId: leg.fromId,
      transferToAccountId: leg.toId,
      externalId: `maybe-tr-${crypto.createHash("sha1").update(basis).digest("hex").slice(0, 24)}`,
    });
  }

  return { rows: [...plain, ...transfers], transfers: transfers.length, paired };
}

// GET what is in the file and how each account name lines up with FinTrack,
// so the mapping can be confirmed before anything is written.
router.post("/maybe/inspect", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  let rows;
  try {
    rows = await readCsvRows(req.file.path);
  } catch (err) {
    return res.status(400).json({ error: `Could not read the CSV: ${err.message}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }

  const { parsed, skipped } = parseAll(rows, parseMaybeRow);
  const accounts = await prisma.account.findMany({ select: { id: true, name: true } });
  const byName = new Map(accounts.map((a) => [nameKey(a.name), a]));

  const groups = [...groupByAccountName(parsed).values()].map((g) => ({
    name: g.name,
    count: g.rows.length,
    matchedAccount: g.name ? byName.get(nameKey(g.name)) || null : null,
  }));
  groups.sort((a, b) => b.count - a.count);

  res.json({
    total: parsed.length,
    skipped,
    hasAccountColumn: groups.some((g) => g.name),
    groups,
  });
});

router.post("/maybe", upload.single("file"), async (req, res) => {
  const { accountId } = req.body;
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  // { "<name in the CSV>": "<FinTrack account id>" }. Anything unmapped falls
  // back to accountId, which keeps single-account exports working as before.
  let accountMap = {};
  if (req.body.accountMap) {
    try {
      accountMap = JSON.parse(req.body.accountMap);
    } catch {
      return res.status(400).json({ error: "accountMap is not valid JSON" });
    }
  }
  if (!accountId && Object.keys(accountMap).length === 0) {
    return res.status(400).json({ error: "accountId or accountMap required" });
  }

  let rows;
  try {
    rows = await readCsvRows(req.file.path);
  } catch (err) {
    return res.status(400).json({ error: `Could not read the CSV: ${err.message}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }

  const { parsed, skipped: parseSkipped, errors } = parseAll(rows, parseMaybeRow);
  const mapByKey = new Map(Object.entries(accountMap).map(([k, v]) => [nameKey(k), v]));

  // Merge both legs of each internal transfer before anything is written
  const linked = linkMaybeTransfers(parsed, mapByKey);

  const totals = {
    imported: 0,
    skipped: parseSkipped,
    errors: [...errors],
    transfers: linked.transfers,
    transfersPaired: linked.paired,
  };
  const perAccount = [];

  // A transfer belongs to the account it leaves, whatever row it came from
  const idToName = new Map();
  for (const [key, id] of mapByKey) idToName.set(id, key);
  for (const row of linked.rows) {
    if (row.type === "TRANSFER") row.accountName = idToName.get(row.transferFromAccountId) || row.accountName;
  }

  for (const group of groupByAccountName(linked.rows).values()) {
    const target = mapByKey.get(nameKey(group.name)) || accountId;
    if (!target) {
      // Nowhere to put these: report instead of silently dropping them
      totals.skipped += group.rows.length;
      totals.errors.push(`No account selected for "${group.name}" — ${group.rows.length} rows skipped`);
      continue;
    }
    const result = await persistRows(group.rows, target, "maybe");
    totals.imported += result.imported;
    totals.skipped += result.skipped;
    totals.errors.push(...result.errors);
    perAccount.push({ name: group.name, accountId: target, ...result });
  }

  res.json({ ...totals, errors: totals.errors.slice(0, 10), perAccount });
});

router.post("/generic", upload.single("file"), async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  const results = await importCsv(req.file.path, accountId, parseGenericRow, "generic");
  fs.unlinkSync(req.file.path);
  res.json(results);
});

// ABN AMRO hands out one small file per day, so every CAMT endpoint takes a
// batch. Parses each file, cleans up the uploads, and reports per-file errors.
function readCamtBatch(files) {
  const entries = [];
  const ibans = new Set();
  const errors = [];
  let currency = null;

  for (const file of files) {
    try {
      const parsed = parseCamt053(fs.readFileSync(file.path, "utf8"));
      entries.push(...parsed.entries);
      if (parsed.iban) ibans.add(normaliseIban(parsed.iban));
      currency = currency || parsed.currency;
    } catch (err) {
      errors.push(`${file.originalname}: ${err.message}`);
    } finally {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }

  return { entries, ibans: [...ibans], currency, errors };
}

// Compared in JS rather than SQL so accounts saved before IBANs were
// normalised still match.
async function findAccountByIban(iban) {
  if (!iban) return null;
  const target = normaliseIban(iban);
  const accounts = await prisma.account.findMany({
    where: { iban: { not: null } },
    select: { id: true, name: true, iban: true },
  });
  const hit = accounts.find((a) => normaliseIban(a.iban) === target);
  return hit ? { id: hit.id, name: hit.name } : null;
}

// Inspect statements without importing, so the UI can show what is in them and
// preselect the account matching their IBAN.
router.post("/camt/inspect", upload.array("files", 400), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: "CAMT.053 XML file required" });

  const batch = readCamtBatch(files);
  if (batch.entries.length === 0 && batch.errors.length > 0) {
    return res.status(400).json({ error: batch.errors[0] });
  }

  const dates = batch.entries.map((e) => e.date).sort((a, b) => a - b);

  res.json({
    fileCount: files.length,
    iban: batch.ibans[0] || null,
    ibans: batch.ibans,
    multipleAccounts: batch.ibans.length > 1,
    currency: batch.currency,
    count: batch.entries.length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    matchedAccount: batch.ibans.length === 1 ? await findAccountByIban(batch.ibans[0]) : null,
    errors: batch.errors.slice(0, 10),
  });
});

router.post("/camt", upload.array("files", 400), async (req, res) => {
  const { accountId } = req.body;
  const files = req.files || [];
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  if (files.length === 0) return res.status(400).json({ error: "CAMT.053 XML file required" });

  const batch = readCamtBatch(files);
  if (batch.entries.length === 0) {
    return res.status(400).json({
      error: batch.errors[0] || "No transactions found in the selected files",
    });
  }
  // Guard against dumping two different bank accounts into one FinTrack account
  if (batch.ibans.length > 1) {
    return res.status(400).json({
      error: `The selected files belong to different accounts (${batch.ibans.join(", ")}). Import one account at a time.`,
    });
  }

  // Falls back to the configured default when the request does not specify one.
  const mode = MODES.includes(req.body.transferMode)
    ? req.body.transferMode
    : await getDefaultMode();

  let rows = batch.entries;
  let linked = 0;
  let mirrorsSkipped = 0;
  if (mode === "auto") {
    const applied = await applyAutoTransfers(rows, accountId);
    rows = applied.rows;
    linked = applied.linked;
    mirrorsSkipped = applied.mirrorsSkipped;
  }

  const results = await persistRows(rows, accountId, "camt053", { errors: batch.errors });

  // In confirm mode, show what could be merged rather than doing it silently.
  const candidates = mode === "confirm" ? await findTransferCandidates() : [];

  res.json({
    ...results,
    skipped: results.skipped + mirrorsSkipped,
    fileCount: files.length,
    iban: batch.ibans[0] || null,
    currency: batch.currency,
    transferMode: mode,
    transfersLinked: linked,
    transferCandidates: candidates.length,
  });
});

// Candidate transfer pairs awaiting confirmation
router.get("/transfers/candidates", async (req, res) => {
  res.json(await findTransferCandidates());
});

// Counterparty IBANs seen in transactions that match no account — the usual
// reason a transfer to your own savings account is not detected.
router.get("/transfers/unlinked-ibans", async (req, res) => {
  res.json(await unlinkedCounterpartyIbans());
});

// Convert a single imported row into a transfer (only one side was imported)
router.post("/transfers/convert", async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    res.json(await convertCandidate(id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Collapse a confirmed pair into a single TRANSFER row
router.post("/transfers/merge", async (req, res) => {
  const { outgoingId, incomingId } = req.body;
  if (!outgoingId || !incomingId) {
    return res.status(400).json({ error: "outgoingId and incomingId required" });
  }
  try {
    res.json(await mergeCandidate(outgoingId, incomingId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function importCsv(filePath, accountId, rowParser, source) {
  const content = fs.readFileSync(filePath, "utf8");

  const rows = await new Promise((resolve, reject) => {
    parse(content, { columns: true, skip_empty_lines: true, trim: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  let skipped = 0;
  const errors = [];

  // Parse every row up front
  const parsedRows = [];
  for (const row of rows) {
    try {
      const parsed = rowParser(row);
      if (isNaN(parsed.amount) || isNaN(parsed.date.getTime())) {
        skipped++;
        continue;
      }
      parsedRows.push(parsed);
    } catch (err) {
      errors.push(err.message);
      skipped++;
    }
  }

  return persistRows(parsedRows, accountId, source, { skipped, errors });
}


router.delete("/clear", async (req, res) => {
  const { accountId, source } = req.query;
  if (!accountId) return res.status(400).json({ error: "accountId required" });

  const where = { accountId, importedFrom: source || undefined };
  const deleted = await prisma.transaction.deleteMany({ where });

  // Recalculate balance from remaining transactions
  const [income, expense] = await Promise.all([
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { accountId, type: "INCOME" } }),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { accountId, type: "EXPENSE" } }),
  ]);
  const newBalance = Number(income._sum.amount || 0) - Number(expense._sum.amount || 0);
  await prisma.account.update({ where: { id: accountId }, data: { balance: newBalance } });

  res.json({ deleted: deleted.count, newBalance });
});

module.exports = router;
