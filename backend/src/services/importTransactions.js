const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Shared persistence for every import source (CSV, CAMT.053, future bank sync).
// Resolves categories and existing externalIds in bulk, then inserts in batched
// transactions — inserting row by row was slow enough to trip nginx's timeout.
//
// parsedRows: [{ date, description, amount, type, categoryName?, notes?, externalId? }]
async function persistRows(parsedRows, accountId, source, initial = {}) {
  let skipped = initial.skipped || 0;
  const errors = initial.errors || [];

  // Resolve every category in one pass instead of a query per row
  const categoryIdByName = new Map();
  const existingCategories = await prisma.category.findMany({ select: { id: true, name: true } });
  for (const c of existingCategories) categoryIdByName.set(c.name.toLowerCase(), c.id);

  const wantedNames = [...new Set(parsedRows.map((p) => p.categoryName).filter(Boolean))];
  for (const name of wantedNames) {
    if (categoryIdByName.has(name.toLowerCase())) continue;
    const created = await prisma.category.create({ data: { name, color: "#6b7280" } });
    categoryIdByName.set(name.toLowerCase(), created.id);
  }

  // Fetch already-imported externalIds in one query instead of a lookup per row
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

  // One commit per chunk rather than per row
  let imported = 0;
  const CHUNK_SIZE = 200;
  for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + CHUNK_SIZE);
    try {
      await prisma.$transaction(chunk.map((data) => prisma.transaction.create({ data })));
      imported += chunk.length;
    } catch (err) {
      // Fall back to per-row inserts so one bad row cannot fail a whole chunk
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

module.exports = { persistRows };
