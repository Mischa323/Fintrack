const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const items = await prisma.recurringTransaction.findMany({
    include: { account: true, category: true },
    orderBy: { nextDate: "asc" },
  });
  res.json(items);
});

router.post("/", async (req, res) => {
  const { accountId, categoryId, amount, description, type, frequency, startDate, endDate } = req.body;
  const item = await prisma.recurringTransaction.create({
    data: {
      accountId,
      categoryId: categoryId || null,
      amount,
      description,
      type,
      frequency,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      nextDate: new Date(startDate),
    },
    include: { account: true, category: true },
  });
  res.status(201).json(item);
});

router.put("/:id", async (req, res) => {
  const { categoryId, amount, description, frequency, endDate, active } = req.body;
  const item = await prisma.recurringTransaction.update({
    where: { id: req.params.id },
    data: {
      categoryId: categoryId || null,
      amount,
      description,
      frequency,
      endDate: endDate ? new Date(endDate) : null,
      active,
    },
    include: { account: true, category: true },
  });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  await prisma.recurringTransaction.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
