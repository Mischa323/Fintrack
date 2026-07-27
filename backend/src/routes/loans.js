const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

const LOAN_INCLUDE = { payments: { orderBy: { date: "desc" } }, account: true };

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

// ── Linked-account bookkeeping ───────────────────────────────────────────────
// When a loan is tied to an account, lending is an EXPENSE (money out) and each
// repayment an INCOME (money back), so a full repayment nets to zero and the
// balance is always right. Every booking must be a real Transaction row —
// recalculateBalance is openingBalance + Σ(transactions), so a direct balance
// nudge would be undone on the next recalc. The ids are stored so an edit or
// delete can reverse the exact rows it created.

async function bookTx(tx, { accountId, type, amount, description, date }) {
  const created = await tx.transaction.create({
    data: {
      accountId,
      type,
      amount: Number(amount),
      description,
      date: date ? new Date(date) : new Date(),
    },
  });
  const effect = type === "INCOME" ? Number(amount) : -Number(amount);
  await tx.account.update({ where: { id: accountId }, data: { balance: { increment: effect } } });
  return created.id;
}

async function reverseTx(tx, transactionId) {
  if (!transactionId) return;
  // The user may have deleted the transaction directly in the Transactions page;
  // if it is gone there is nothing to reverse.
  const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
  if (!existing) return;
  const effect = existing.type === "INCOME" ? Number(existing.amount) : -Number(existing.amount);
  await tx.account.update({ where: { id: existing.accountId }, data: { balance: { increment: -effect } } });
  await tx.transaction.delete({ where: { id: transactionId } });
}

// An investment account's balance comes from its holdings and would be clobbered
// on the next price refresh, so a loan may not be booked on one.
async function checkLinkable(accountId) {
  if (!accountId) return {};
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, type: true } });
  if (!account) return { error: "The linked account was not found" };
  if (account.type === "INVESTMENT") {
    return { error: "An investment account's balance comes from its holdings, so a loan cannot be booked on it. Pick a checking, savings or cash account." };
  }
  return { account };
}

// GET /loans — active loans by default; ?includeArchived=true adds settled ones
// that were filed away.
router.get("/", async (req, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const loans = await prisma.loan.findMany({
    where: includeArchived ? {} : { archived: false },
    include: LOAN_INCLUDE,
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
  const { person, description, principal, currency, date, dueDate, notes, color, accountId } = req.body;
  if (!person?.trim()) return res.status(400).json({ error: "Who did you lend to? A name is required" });
  if (!principal || Number(principal) <= 0) return res.status(400).json({ error: "The amount lent must be greater than zero" });

  const link = await checkLinkable(accountId);
  if (link.error) return res.status(400).json({ error: link.error });

  const fields = {
    person: person.trim(),
    description: description?.trim() || null,
    principal: Number(principal),
    currency: (currency || "EUR").toUpperCase(),
    date: date ? new Date(date) : new Date(),
    dueDate: dueDate ? new Date(dueDate) : null,
    notes: notes?.trim() || null,
    color: color || "#6366f1",
    accountId: accountId || null,
  };

  const loan = await prisma.$transaction(async (tx) => {
    const created = await tx.loan.create({ data: fields });
    if (created.accountId) {
      const lendTransactionId = await bookTx(tx, {
        accountId: created.accountId,
        type: "EXPENSE",
        amount: created.principal,
        description: `Loan to ${created.person}`,
        date: created.date,
      });
      await tx.loan.update({ where: { id: created.id }, data: { lendTransactionId } });
    }
    return tx.loan.findUnique({ where: { id: created.id }, include: LOAN_INCLUDE });
  });
  res.status(201).json(withComputed(loan));
});

router.put("/:id", async (req, res) => {
  const { person, description, principal, currency, date, dueDate, notes, color, accountId } = req.body;
  if (!person?.trim()) return res.status(400).json({ error: "Who did you lend to? A name is required" });
  if (!principal || Number(principal) <= 0) return res.status(400).json({ error: "The amount lent must be greater than zero" });

  const existing = await prisma.loan.findUnique({ where: { id: req.params.id }, include: { payments: true } });
  if (!existing) return res.status(404).json({ error: "Loan not found" });

  const link = await checkLinkable(accountId);
  if (link.error) return res.status(400).json({ error: link.error });

  const fields = {
    person: person.trim(),
    description: description?.trim() || null,
    principal: Number(principal),
    currency: (currency || "EUR").toUpperCase(),
    date: date ? new Date(date) : existing.date,
    dueDate: dueDate ? new Date(dueDate) : null,
    notes: notes?.trim() || null,
    color: color || "#6366f1",
    accountId: accountId || null,
  };

  // Rebook cleanly: reverse every booking this loan made, apply the edits, then
  // re-create the bookings on the (possibly new) account. This keeps everything
  // consistent when the amount, dates or the linked account itself change.
  const loan = await prisma.$transaction(async (tx) => {
    await reverseTx(tx, existing.lendTransactionId);
    for (const p of existing.payments) await reverseTx(tx, p.transactionId);

    await tx.loan.update({ where: { id: existing.id }, data: { ...fields, lendTransactionId: null } });
    await tx.loanPayment.updateMany({ where: { loanId: existing.id }, data: { transactionId: null } });

    if (fields.accountId) {
      const lendTransactionId = await bookTx(tx, {
        accountId: fields.accountId,
        type: "EXPENSE",
        amount: fields.principal,
        description: `Loan to ${fields.person}`,
        date: fields.date,
      });
      await tx.loan.update({ where: { id: existing.id }, data: { lendTransactionId } });

      const payments = await tx.loanPayment.findMany({ where: { loanId: existing.id } });
      for (const p of payments) {
        const transactionId = await bookTx(tx, {
          accountId: fields.accountId,
          type: "INCOME",
          amount: p.amount,
          description: `Repayment from ${fields.person}`,
          date: p.date,
        });
        await tx.loanPayment.update({ where: { id: p.id }, data: { transactionId } });
      }
    }
    return tx.loan.findUnique({ where: { id: existing.id }, include: LOAN_INCLUDE });
  });
  res.json(withComputed(loan));
});

// POST /loans/:id/archive — file a settled loan away (or bring it back) without
// deleting its history or its account bookings. { archived: true|false }
router.post("/:id/archive", async (req, res) => {
  const loan = await prisma.loan.update({
    where: { id: req.params.id },
    data: { archived: req.body.archived !== false },
    include: LOAN_INCLUDE,
  });
  res.json(withComputed(loan));
});

router.delete("/:id", async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.loan.findUnique({ where: { id: req.params.id }, include: { payments: true } });
    if (!existing) return;
    // Undo the account bookings before the rows vanish, so the balance is left
    // as if the loan had never touched it.
    await reverseTx(tx, existing.lendTransactionId);
    for (const p of existing.payments) await reverseTx(tx, p.transactionId);
    await tx.loan.delete({ where: { id: existing.id } });
  });
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

// POST /loans/:id/payments — log a repayment (and book it as income if linked)
router.post("/:id/payments", async (req, res) => {
  const { amount, date, notes } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Enter a repayment amount greater than zero" });

  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } });
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  await prisma.$transaction(async (tx) => {
    let transactionId = null;
    if (loan.accountId) {
      transactionId = await bookTx(tx, {
        accountId: loan.accountId,
        type: "INCOME",
        amount,
        description: `Repayment from ${loan.person}`,
        date,
      });
    }
    await tx.loanPayment.create({
      data: {
        loanId: loan.id,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        notes: notes?.trim() || null,
        transactionId,
      },
    });
  });

  const updated = await prisma.loan.findUnique({ where: { id: loan.id }, include: LOAN_INCLUDE });
  res.status(201).json(withComputed(updated));
});

// DELETE /loans/:id/payments/:paymentId — undo a mistaken repayment (and its
// income booking, if any)
router.delete("/:id/payments/:paymentId", async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.loanPayment.findFirst({ where: { id: req.params.paymentId, loanId: req.params.id } });
    if (!payment) return;
    await reverseTx(tx, payment.transactionId);
    await tx.loanPayment.delete({ where: { id: payment.id } });
  });
  const updated = await prisma.loan.findUnique({ where: { id: req.params.id }, include: LOAN_INCLUDE });
  if (!updated) return res.status(404).json({ error: "Loan not found" });
  res.json(withComputed(updated));
});

module.exports = router;
