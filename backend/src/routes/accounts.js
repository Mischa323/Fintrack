const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: "asc" },
  });
  res.json(accounts);
});

router.post("/", async (req, res) => {
  const { name, type, currency, balance, color, icon, institution } = req.body;
  const account = await prisma.account.create({
    data: { name, type, currency: currency || "EUR", balance: balance || 0, color, icon, institution },
  });
  res.status(201).json(account);
});

router.put("/:id", async (req, res) => {
  const { name, type, currency, color, icon, institution } = req.body;
  const account = await prisma.account.update({
    where: { id: req.params.id },
    data: { name, type, currency, color, icon, institution },
  });
  res.json(account);
});

router.delete("/:id", async (req, res) => {
  await prisma.account.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Recalculate account balance from transactions
router.post("/:id/recalculate", async (req, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { accountId: req.params.id },
  });
  const balance = transactions.reduce((sum, t) => {
    return sum + (t.type === "INCOME" ? Number(t.amount) : -Number(t.amount));
  }, 0);
  const account = await prisma.account.update({
    where: { id: req.params.id },
    data: { balance },
  });
  res.json(account);
});

module.exports = router;
