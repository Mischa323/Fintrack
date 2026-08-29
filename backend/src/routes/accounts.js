const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { normaliseIban } = require("../services/iban");
const { recalculateBalance, reconcileToBalance, sumTransactions } = require("../services/accountBalance");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const accounts = await prisma.account.findMany({
    // User-set order first; createdAt breaks ties so accounts that predate the
    // ordering feature (all at sortOrder 0) keep their original sequence.
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json(accounts);
});

router.post("/", async (req, res) => {
  const { name, type, currency, balance, color, icon, institution, iban, groupName } = req.body;
  // New accounts go to the end of the list.
  const last = await prisma.account.aggregate({ _max: { sortOrder: true } });
  const account = await prisma.account.create({
    data: {
      name, type, currency: currency || "EUR", balance: balance || 0, color, icon, institution,
      iban: normaliseIban(iban),
      groupName: groupName?.trim() || null,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
  res.status(201).json(account);
});

// PUT /accounts/reorder — persist a new display order from a list of ids. Must
// come before "/:id" so "reorder" is not swallowed as an account id.
router.put("/reorder", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: "No account order given" });
  await prisma.$transaction(
    ids.map((id, index) => prisma.account.update({ where: { id }, data: { sortOrder: index } }))
  );
  res.json({ ordered: ids.length });
});

router.put("/:id", async (req, res) => {
  const { name, type, currency, color, icon, institution, iban, groupName } = req.body;
  const account = await prisma.account.update({
    where: { id: req.params.id },
    data: {
      name, type, currency, color, icon, institution,
      iban: normaliseIban(iban),
      ...(groupName !== undefined ? { groupName: groupName?.trim() || null } : {}),
    },
  });
  res.json(account);
});

router.delete("/:id", async (req, res) => {
  await prisma.account.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Recalculate account balance. recalculateBalance derives an investment
// account's balance from its holdings and every other account from
// openingBalance + recorded movements, so this route stays simple.
router.post("/:id/recalculate", async (req, res) => {
  const balance = await recalculateBalance(req.params.id);
  if (balance === null) return res.status(404).json({ error: "Account not found" });
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  // Movements that count toward the balance are only those after the checkpoint;
  // an investment balance comes from holdings, so there are none to report.
  const movements = account.type === "INVESTMENT"
    ? 0
    : await sumTransactions(req.params.id, account.openingBalanceDate || null);
  res.json({ ...account, balance, movements });
});

// Tell FinTrack what the bank actually shows; the opening balance is derived so
// the recorded transactions add up to it. An investment account's balance is the
// value of its holdings, so there is nothing to set by hand.
router.post("/:id/reconcile", async (req, res) => {
  const { balance } = req.body;
  if (balance === undefined || isNaN(Number(balance))) {
    return res.status(400).json({ error: "A numeric balance is required" });
  }
  const account = await prisma.account.findUnique({ where: { id: req.params.id }, select: { type: true } });
  if (account?.type === "INVESTMENT") {
    return res.status(400).json({
      error: "An investment account's balance is the value of its holdings — use ↻ to refresh it from the latest prices, don't set it by hand.",
    });
  }
  const result = await reconcileToBalance(req.params.id, Number(balance));
  res.json(result);
});

module.exports = router;
