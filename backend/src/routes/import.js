const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

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

router.post("/maybe", upload.single("file"), async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  const results = await importCsv(req.file.path, accountId, parseMaybeRow, "maybe");
  fs.unlinkSync(req.file.path);
  res.json(results);
});

router.post("/generic", upload.single("file"), async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  const results = await importCsv(req.file.path, accountId, parseGenericRow, "generic");
  fs.unlinkSync(req.file.path);
  res.json(results);
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

  // 1. Parse every row up front
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

  // 2. Resolve every category in one pass instead of a query per row
  const categoryIdByName = new Map();
  const existingCategories = await prisma.category.findMany({ select: { id: true, name: true } });
  for (const c of existingCategories) categoryIdByName.set(c.name.toLowerCase(), c.id);

  const wantedNames = [...new Set(parsedRows.map((p) => p.categoryName).filter(Boolean))];
  for (const name of wantedNames) {
    if (categoryIdByName.has(name.toLowerCase())) continue;
    const created = await prisma.category.create({ data: { name, color: "#6b7280" } });
    categoryIdByName.set(name.toLowerCase(), created.id);
  }

  // 3. Fetch already-imported externalIds in one query instead of a lookup per row
  const externalIds = parsedRows.map((p) => p.externalId).filter(Boolean);
  const seenExternalIds = new Set();
  if (externalIds.length > 0) {
    const existing = await prisma.transaction.findMany({
      where: { accountId, externalId: { in: externalIds } },
      select: { externalId: true },
    });
    for (const t of existing) seenExternalIds.add(t.externalId);
  }

  const toCreate = [];
  for (const p of parsedRows) {
    // Skip rows already imported, and duplicates within the file itself
    if (p.externalId) {
      if (seenExternalIds.has(p.externalId)) { skipped++; continue; }
      seenExternalIds.add(p.externalId);
    }
    toCreate.push({
      accountId,
      categoryId: p.categoryName ? categoryIdByName.get(p.categoryName.toLowerCase()) ?? null : null,
      amount: p.amount,
      description: p.description,
      date: p.date,
      type: p.type,
      notes: p.notes,
      importedFrom: source,
      externalId: p.externalId || null,
    });
  }

  // 4. Insert in batched transactions — one commit per chunk rather than per row,
  //    which is what made large imports slow enough to time out.
  let imported = 0;
  const CHUNK_SIZE = 200;
  for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + CHUNK_SIZE);
    try {
      await prisma.$transaction(chunk.map((data) => prisma.transaction.create({ data })));
      imported += chunk.length;
    } catch (err) {
      // Fall back to per-row inserts so one bad row cannot fail the whole chunk
      for (const data of chunk) {
        try {
          await prisma.transaction.create({ data });
          imported++;
        } catch (rowErr) {
          errors.push(rowErr.message);
          skipped++;
        }
      }
    }
  }

  return { imported, skipped, errors: errors.slice(0, 10) };
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
