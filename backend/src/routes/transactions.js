const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

const INCLUDE = {
  account: true,
  toAccount: true,
  category: true,
  attachments: {
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
};

// Balance delta for a transaction relative to its accountId
function delta(type, amount) {
  return type === "INCOME" ? Number(amount) : -Number(amount);
}

router.get("/", async (req, res) => {
  const { accountId, categoryId, type, from, to, search, page = 1, limit = 50 } = req.query;

  const where = {};
  if (accountId) where.OR = [{ accountId }, { toAccountId: accountId }];
  if (categoryId) where.categoryId = categoryId;
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
