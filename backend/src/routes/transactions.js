const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const { accountId, categoryId, type, from, to, search, page = 1, limit = 50 } = req.query;

  const where = {};
  if (accountId) where.accountId = accountId;
  if (categoryId) where.categoryId = categoryId;
  if (type) where.type = type;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  if (search) where.description = { contains: search, mode: "insensitive" };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { account: true, category: true },
      orderBy: { date: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json({ transactions, total, page: Number(page), limit: Number(limit) });
});

router.post("/", async (req, res) => {
  const { accountId, categoryId, amount, description, date, type, notes } = req.body;

  const transaction = await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.create({
      data: {
        accountId,
        categoryId: categoryId || null,
        amount,
        description,
        date: new Date(date),
        type,
        notes,
      },
      include: { account: true, category: true },
    });

    const delta = type === "INCOME" ? Number(amount) : -Number(amount);
    await tx.account.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });

    return t;
  });

  res.status(201).json(transaction);
});

router.put("/:id", async (req, res) => {
  const { categoryId, amount, description, date, type, notes } = req.body;

  const transaction = await prisma.$transaction(async (tx) => {
    const old = await tx.transaction.findUniqueOrThrow({ where: { id: req.params.id } });

    const oldDelta = old.type === "INCOME" ? Number(old.amount) : -Number(old.amount);
    const newDelta = type === "INCOME" ? Number(amount) : -Number(amount);

    await tx.account.update({
      where: { id: old.accountId },
      data: { balance: { increment: newDelta - oldDelta } },
    });

    return tx.transaction.update({
      where: { id: req.params.id },
      data: { categoryId: categoryId || null, amount, description, date: new Date(date), type, notes },
      include: { account: true, category: true },
    });
  });

  res.json(transaction);
});

router.delete("/:id", async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.findUniqueOrThrow({ where: { id: req.params.id } });
    const delta = t.type === "INCOME" ? -Number(t.amount) : Number(t.amount);
    await tx.account.update({ where: { id: t.accountId }, data: { balance: { increment: delta } } });
    await tx.transaction.delete({ where: { id: req.params.id } });
  });
  res.status(204).end();
});

module.exports = router;
