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

router.get("/monthly", async (req, res) => {
  const months = 6;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const transactions = await prisma.transaction.findMany({
    where: { date: { gte: from } },
    select: { amount: true, type: true, date: true },
  });

  const data = {};
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    data[key] = { month: key, income: 0, expenses: 0 };
  }

  for (const t of transactions) {
    const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    if (!data[key]) continue;
    if (t.type === "INCOME") data[key].income += Number(t.amount);
    else if (t.type === "EXPENSE") data[key].expenses += Number(t.amount);
  }

  res.json(Object.values(data).reverse());
});

module.exports = router;
