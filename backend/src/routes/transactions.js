const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

const INCLUDE = { account: true, toAccount: true, category: true };

// Balance delta for a transaction relative to its accountId
function delta(type, amount) {
  return type === "INCOME" ? Number(amount) : -Number(amount);
}

router.get("/", async (req, res) => {
  const { accountId, categoryId, type, from, to, search, page = 1, limit = 50 } = req.query;

  const where = {};
  if (accountId) where.OR = [{ accountId }, { toAccountId: accountId }];
  // "none" filters the transactions with no category, so they can be found and
  // fixed after an import.
  if (categoryId === "none") where.categoryId = null;
  else if (categoryId) where.categoryId = categoryId;
  if (type) where.type = type;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  if (search) where.description = { contains: search };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: INCLUDE,
      orderBy: { date: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json({ transactions, total, page: Number(page), limit: Number(limit) });
});

// Net balance correction per account, so a bulk action touches each account
// once instead of once per transaction.
function collectAdjustments(rows, reverse) {
  const adjust = new Map();
  const bump = (accountId, amount) => {
    if (!accountId) return;
    adjust.set(accountId, (adjust.get(accountId) || 0) + amount);
  };
  const sign = reverse ? -1 : 1;
  for (const t of rows) {
    if (t.type === "TRANSFER") {
      bump(t.accountId, sign * -Number(t.amount));
      bump(t.toAccountId, sign * Number(t.amount));
    } else {
      bump(t.accountId, sign * delta(t.type, t.amount));
    }
  }
  return adjust;
}

async function applyAdjustments(tx, adjust) {
  for (const [accountId, amount] of adjust) {
    if (amount === 0) continue;
    await tx.account.update({ where: { id: accountId }, data: { balance: { increment: amount } } });
  }
}

// POST /transactions/bulk-delete — remove many at once, undoing their balances
router.post("/bulk-delete", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: "No transactions selected" });

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.transaction.findMany({ where: { id: { in: ids } } });
    if (rows.length === 0) return { deleted: 0 };

    await applyAdjustments(tx, collectAdjustments(rows, true));
    await tx.transaction.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return { deleted: rows.length };
  });

  res.json(result);
});

// PATCH /transactions/bulk — change category, type or notes on many at once.
// Amount and date are deliberately not bulk-editable.
router.patch("/bulk", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: "No transactions selected" });

  const { categoryId, type, notes } = req.body;
  if (type && !["INCOME", "EXPENSE"].includes(type)) {
    return res.status(400).json({ error: "Bulk type change supports INCOME or EXPENSE only" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.transaction.findMany({ where: { id: { in: ids } } });
    if (rows.length === 0) return { updated: 0, skippedTransfers: 0 };

    const data = {};
    if (categoryId !== undefined) data.categoryId = categoryId || null;
    if (notes !== undefined) data.notes = notes || null;

    // A transfer's direction depends on toAccountId, so it cannot be flipped
    // to income or expense in bulk — those rows are left untouched.
    let targets = rows;
    let skippedTransfers = 0;
    if (type) {
      targets = rows.filter((r) => r.type !== "TRANSFER");
      skippedTransfers = rows.length - targets.length;

      const adjust = new Map();
      for (const t of targets) {
        if (t.type === type) continue;
        const change = delta(type, t.amount) - delta(t.type, t.amount);
        adjust.set(t.accountId, (adjust.get(t.accountId) || 0) + change);
      }
      await applyAdjustments(tx, adjust);
      data.type = type;
    }

    if (Object.keys(data).length === 0) return { updated: 0, skippedTransfers };

    const updated = await tx.transaction.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data,
    });
    return { updated: updated.count, skippedTransfers };
  });

  res.json(result);
});

router.post("/", async (req, res) => {
  const { accountId, toAccountId, categoryId, amount, description, date, type, notes } = req.body;

  const transaction = await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.create({
      data: {
        accountId,
        toAccountId: type === "TRANSFER" ? (toAccountId || null) : null,
        categoryId: categoryId || null,
        amount,
        description,
        date: new Date(date),
        type,
        notes,
      },
      include: INCLUDE,
    });

    if (type === "TRANSFER") {
      // Debit source, credit destination
      await tx.account.update({ where: { id: accountId }, data: { balance: { decrement: Number(amount) } } });
      if (toAccountId) {
        await tx.account.update({ where: { id: toAccountId }, data: { balance: { increment: Number(amount) } } });
      }
    } else {
      await tx.account.update({ where: { id: accountId }, data: { balance: { increment: delta(type, amount) } } });
    }

    return t;
  });

  res.status(201).json(transaction);
});

router.put("/:id", async (req, res) => {
  const { categoryId, amount, description, date, type, notes, toAccountId } = req.body;

  const transaction = await prisma.$transaction(async (tx) => {
    const old = await tx.transaction.findUniqueOrThrow({ where: { id: req.params.id } });

    // Reverse the old transaction's balance effect
    if (old.type === "TRANSFER") {
      await tx.account.update({ where: { id: old.accountId }, data: { balance: { increment: Number(old.amount) } } });
      if (old.toAccountId) {
        await tx.account.update({ where: { id: old.toAccountId }, data: { balance: { decrement: Number(old.amount) } } });
      }
    } else {
      await tx.account.update({ where: { id: old.accountId }, data: { balance: { increment: -delta(old.type, old.amount) } } });
    }

    // Apply the new transaction's balance effect
    if (type === "TRANSFER") {
      await tx.account.update({ where: { id: old.accountId }, data: { balance: { decrement: Number(amount) } } });
      if (toAccountId) {
        await tx.account.update({ where: { id: toAccountId }, data: { balance: { increment: Number(amount) } } });
      }
    } else {
      await tx.account.update({ where: { id: old.accountId }, data: { balance: { increment: delta(type, amount) } } });
    }

    return tx.transaction.update({
      where: { id: req.params.id },
      data: {
        categoryId: categoryId || null,
        amount,
        description,
        date: new Date(date),
        type,
        notes,
        toAccountId: type === "TRANSFER" ? (toAccountId || null) : null,
      },
      include: INCLUDE,
    });
  });

  res.json(transaction);
});

router.delete("/:id", async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.findUniqueOrThrow({ where: { id: req.params.id } });

    if (t.type === "TRANSFER") {
      await tx.account.update({ where: { id: t.accountId }, data: { balance: { increment: Number(t.amount) } } });
      if (t.toAccountId) {
        await tx.account.update({ where: { id: t.toAccountId }, data: { balance: { decrement: Number(t.amount) } } });
      }
    } else {
      await tx.account.update({ where: { id: t.accountId }, data: { balance: { increment: -delta(t.type, t.amount) } } });
    }

    await tx.transaction.delete({ where: { id: t.id } });
  });
  res.status(204).end();
});

module.exports = router;
