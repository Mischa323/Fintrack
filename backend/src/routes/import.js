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

async function resolveCategory(name) {
  if (!name) return null;
  const cat = await prisma.category.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (cat) return cat.id;
  const created = await prisma.category.create({
    data: { name, color: "#6b7280" },
  });
  return created.id;
}

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

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const parsed = rowParser(row);
      if (isNaN(parsed.amount) || isNaN(parsed.date.getTime())) {
        skipped++;
        continue;
      }

      const categoryId = await resolveCategory(parsed.categoryName);

      const data = {
        accountId,
        categoryId,
        amount: parsed.amount,
        description: parsed.description,
        date: parsed.date,
        type: parsed.type,
        notes: parsed.notes,
        importedFrom: source,
        externalId: parsed.externalId || null,
      };

      if (parsed.externalId) {
        await prisma.transaction.upsert({
          where: { externalId_accountId: { externalId: parsed.externalId, accountId } },
          create: data,
          update: {},
        });
      } else {
        await prisma.transaction.create({ data });
      }

      const delta = parsed.type === "INCOME" ? parsed.amount : -parsed.amount;
      await prisma.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } },
      });

      imported++;
    } catch (err) {
      errors.push(err.message);
      skipped++;
    }
  }

  return { imported, skipped, errors: errors.slice(0, 10) };
}

module.exports = router;
