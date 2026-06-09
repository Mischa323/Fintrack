const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const goals = await prisma.goal.findMany({
    include: { account: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(goals);
});

router.post("/", async (req, res) => {
  const { name, description, targetAmount, savedAmount, accountId, targetDate, color } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!targetAmount || Number(targetAmount) <= 0) return res.status(400).json({ error: "Target amount must be greater than zero" });

  const goal = await prisma.goal.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      targetAmount: Number(targetAmount),
      savedAmount: Number(savedAmount) || 0,
      accountId: accountId || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      color: color || "#6366f1",
    },
    include: { account: true },
  });

  res.status(201).json(goal);
});

router.put("/:id", async (req, res) => {
  const { name, description, targetAmount, savedAmount, accountId, targetDate, color } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!targetAmount || Number(targetAmount) <= 0) return res.status(400).json({ error: "Target amount must be greater than zero" });

  const goal = await prisma.goal.update({
    where: { id: req.params.id },
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      targetAmount: Number(targetAmount),
      savedAmount: Number(savedAmount) || 0,
      accountId: accountId || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      color: color || "#6366f1",
    },
    include: { account: true },
  });

  res.json(goal);
});

router.delete("/:id", async (req, res) => {
  await prisma.goal.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
