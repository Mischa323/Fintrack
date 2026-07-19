const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { normaliseIban } = require("../services/iban");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: "asc" },
  });
  res.json(accounts);
});

router.post("/", async (req, res) => {
  const { name, type, currency, balance, color, icon, institution, iban } = req.body;
  const account = await prisma.account.create({
    data: { name, type, currency: currency || "EUR", balance: balance || 0, color, icon, institution, iban: normaliseIban(iban) },
  });
  res.status(201).json(account);
});

router.put("/:id", async (req, res) => {
  const { name, type, currency, color, icon, institution, iban } = req.body;
  const account = await prisma.account.update({
    where: { id: req.params.id },
    data: { name, type, currency, color, icon, institution, iban: normaliseIban(iban) },
  });
  res.json(account);
});

router.delete("/:id", async (req, res) => {
  await prisma.account.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Recalculate account balance from transactions
router.post("/:id/recalculate", async (req, res) => {
  const id = req.params.id;
  // Transfers are stored as a single row on the paying account, so money
  // arriving via toAccountId has to be counted too.
  const transactions = await prisma.transaction.findMany({
    where: { OR: [{ accountId: id }, { toAccountId: id }] },
  });
  const balance = transactions.reduce((sum, t) => {
    if (t.toAccountId === id) return sum + Number(t.amount); // incoming transfer
    if (t.type === "INCOME") return sum + Number(t.amount);
    return sum - Number(t.amount); // EXPENSE, or a transfer leaving this account
  }, 0);
  const account = await prisma.account.update({
    where: { id: req.params.id },
    data: { balance },
  });
  res.json(account);
});

module.exports = router;
