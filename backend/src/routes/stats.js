const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/overview", async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const where = Object.keys(dateFilter).length ? { date: dateFilter } : {};

  const [accounts, incomeAgg, expenseAgg, byCategory] = await Promise.all([
    prisma.account.findMany(),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...where, type: "INCOME" } }),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...where, type: "EXPENSE" } }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      _sum: { amount: true },
      where: { ...where, type: "EXPENSE" },
    }),
  ]);

  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0);
  const totalIncome = Number(incomeAgg._sum.amount || 0);
  const totalExpenses = Number(expenseAgg._sum.amount || 0);

  const categoryIds = byCategory.map((g) => g.categoryId).filter(Boolean);
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const spendingByCategory = byCategory.map((g) => ({
    category: g.categoryId ? catMap[g.categoryId] : { name: "Uncategorized", color: "#6b7280" },
    amount: Number(g._sum.amount),
  }));

  res.json({ totalBalance, totalIncome, totalExpenses, spendingByCategory, accounts });
});

// Buckets income/expenses over a period. Falls back to the last 6 months when no
// range is given. Spans longer than two years are grouped by year so the chart
// stays readable instead of rendering 60+ bars.
router.get("/monthly", async (req, res) => {
  const { from, to } = req.query;
  const end = to ? new Date(to) : new Date();

  let start = from ? new Date(from) : null;
  if (!start) {
    const earliest = await prisma.transaction.findFirst({
      orderBy: { date: "asc" },
      select: { date: true },
    });
    start = earliest?.date || new Date(end.getFullYear(), end.getMonth() - 5, 1);
  }
  if (start > end) start = new Date(end.getFullYear(), end.getMonth() - 5, 1);

  const transactions = await prisma.transaction.findMany({
    where: { date: { gte: start, lte: end } },
    select: { amount: true, type: true, date: true },
  });

  const spanMonths =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  const byYear = spanMonths > 24;

  // Pre-seed buckets so periods without transactions still appear on the chart
  const buckets = new Map();
  if (byYear) {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      buckets.set(String(y), { month: String(y), income: 0, expenses: 0 });
    }
  } else {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, { month: key, income: 0, expenses: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  for (const t of transactions) {
    const key = byYear
      ? String(t.date.getFullYear())
      : `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (t.type === "INCOME") bucket.income += Number(t.amount);
    else if (t.type === "EXPENSE") bucket.expenses += Number(t.amount);
  }

  res.json([...buckets.values()]);
});

module.exports = router;
