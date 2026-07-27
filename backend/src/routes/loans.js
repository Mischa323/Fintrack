const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

// Outstanding is derived, never stored: principal minus every repayment. So
// removing a mistaken repayment recomputes the balance cleanly, the same way a
// holding's quantity is replayed from its trades.
function withComputed(loan) {
  const principal = Number(loan.principal);
  const repaid = (loan.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const outstanding = Math.round((principal - repaid) * 100) / 100;
  return {
    ...loan,
    repaid: Math.round(repaid * 100) / 100,
    outstanding,
    // A cent of slack so floating-point sums do not leave a loan "unsettled".
    settled: outstanding <= 0.005,
    overpaid: outstanding < -0.005,
    progress: principal > 0 ? Math.min(100, Math.round((repaid / principal) * 1000) / 10) : 0,
  };
}

// GET /loans — active loans by default; ?includeArchived=true adds settled ones
// that were filed away.
router.get("/", async (req, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const loans = await prisma.loan.findMany({
    where: includeArchived ? {} : { archived: false },
    include: { payments: { orderBy: { date: "desc" } } },
    orderBy: { date: "desc" },
  });
  res.json(loans.map(withComputed));
});

// GET /loans/summary — totals for the active (non-archived) loans, for a header.
router.get("/summary", async (req, res) => {
  const loans = await prisma.loan.findMany({
    where: { archived: false },
    include: { payments: true },
  });
  const computed = loans.map(withComputed);
  const totalLent = computed.reduce((s, l) => s + Number(l.principal), 0);
  const totalRepaid = computed.reduce((s, l) => s + l.repaid, 0);
  res.json({
    totalLent: Math.round(totalLent * 100) / 100,
    totalRepaid: Math.round(totalRepaid * 100) / 100,
    totalOutstanding: Math.round(Math.max(0, totalLent - totalRepaid) * 100) / 100,
    loanCount: computed.length,
    settledCount: computed.filter((l) => l.settled).length,
    people: new Set(computed.map((l) => l.person.trim().toLowerCase())).size,
  });
});

router.post("/", async (req, res) => {
  const { person, description, principal, currency, date, dueDate, notes, color } = req.body;
  if (!person?.trim()) return res.status(400).json({ error: "Who did you lend to? A name is required" });
  if (!principal || Number(principal) <= 0) return res.status(400).json({ error: "The amount lent must be greater than zero" });

  const loan = await prisma.loan.create({
    data: {
      person: person.trim(),
      description: description?.trim() || null,
      principal: Number(principal),
      currency: (currency || "EUR").toUpperCase(),
      date: date ? new Date(date) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes?.trim() || null,
      color: color || "#6366f1",
    },
    include: { payments: true },
  });
  res.status(201).json(withComputed(loan));
});

router.put("/:id", async (req, res) => {
  const { person, description, principal, currency, date, dueDate, notes, color } = req.body;
  if (!person?.trim()) return res.status(400).json({ error: "Who did you lend to? A name is required" });
  if (!principal || Number(principal) <= 0) return res.status(400).json({ error: "The amount lent must be greater than zero" });

  const loan = await prisma.loan.update({
    where: { id: req.params.id },
    data: {
      person: person.trim(),
      description: description?.trim() || null,
      principal: Number(principal),
      currency: (currency || "EUR").toUpperCase(),
      date: date ? new Date(date) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes?.trim() || null,
      color: color || "#6366f1",
    },
    include: { payments: { orderBy: { date: "desc" } } },
  });
  res.json(withComputed(loan));
});

// POST /loans/:id/archive — file a settled loan away (or bring it back) without
// deleting its history. { archived: true|false }
router.post("/:id/archive", async (req, res) => {
  const loan = await prisma.loan.update({
    where: { id: req.params.id },
    data: { archived: req.body.archived !== false },
    include: { payments: { orderBy: { date: "desc" } } },
  });
  res.json(withComputed(loan));
});

router.delete("/:id", async (req, res) => {
  await prisma.loan.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// GET /loans/:id/payments — the repayment history of one loan
router.get("/:id/payments", async (req, res) => {
  const payments = await prisma.loanPayment.findMany({
    where: { loanId: req.params.id },
    orderBy: { date: "desc" },
  });
  res.json(payments);
});

// POST /loans/:id/payments — log a repayment
router.post("/:id/payments", async (req, res) => {
  const { amount, date, notes } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Enter a repayment amount greater than zero" });

  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } });
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  await prisma.loanPayment.create({
    data: {
      loanId: loan.id,
      amount: Number(amount),
      date: date ? new Date(date) : new Date(),
      notes: notes?.trim() || null,
    },
  });

  const updated = await prisma.loan.findUnique({
    where: { id: loan.id },
    include: { payments: { orderBy: { date: "desc" } } },
  });
  res.status(201).json(withComputed(updated));
});

// DELETE /loans/:id/payments/:paymentId — undo a mistaken repayment
router.delete("/:id/payments/:paymentId", async (req, res) => {
  await prisma.loanPayment.deleteMany({
    where: { id: req.params.paymentId, loanId: req.params.id },
  });
  const updated = await prisma.loan.findUnique({
    where: { id: req.params.id },
    include: { payments: { orderBy: { date: "desc" } } },
  });
  if (!updated) return res.status(404).json({ error: "Loan not found" });
  res.json(withComputed(updated));
});

module.exports = router;
