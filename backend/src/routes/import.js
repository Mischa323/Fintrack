const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
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

// Parse Maybe Finance CSV export format
function parseMaybeRow(row) {
  // Maybe Finance exports: date, name, amount, currency, category, account, notes, id
  const amount = Math.abs(parseFloat(row.amount || row.Amount || 0));
  const rawAmount = parseFloat(row.amount || row.Amount || 0);
  const type = rawAmount >= 0 ? "INCOME" : "EXPENSE";

  return {
    date: new Date(row.date || row.Date),
    description: row.name || row.Name || row.description || row.Description || "Imported",
    amount,
    type,
    categoryName: row.category || row.Category || null,
    accountName: row.account || row.Account || null,
    notes: row.notes || row.Notes || null,
    externalId: row.id || row.Id || null,
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
  let skipped = 0;
  for (const row of rows) {
    try {
      const p = rowParser(row);
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

  const totals = { imported: 0, skipped: parseSkipped, errors: [...errors] };
  const perAccount = [];

  for (const group of groupByAccountName(parsed).values()) {
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
