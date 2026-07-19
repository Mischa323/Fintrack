const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    include: { children: true },
    orderBy: { name: "asc" },
  });
  res.json(categories);
});

// GET /categories/flat — every category, with how much each one is used.
// Declared before "/:id" routes so the literal path wins.
router.get("/flat", async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { transactions: true, recurring: true, children: true } },
      parent: { select: { id: true, name: true } },
    },
  });
  res.json(categories);
});

// POST /categories/merge — fold one or more categories into another.
// Everything pointing at a source is repointed at the target, then the sources
// are removed. Nothing is left uncategorised.
router.post("/merge", async (req, res) => {
  const { sourceIds, targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: "targetId required" });

  const sources = (Array.isArray(sourceIds) ? sourceIds : []).filter((id) => id && id !== targetId);
  if (sources.length === 0) {
    return res.status(400).json({ error: "Select at least one category to merge into the target" });
  }

  const target = await prisma.category.findUnique({ where: { id: targetId } });
  if (!target) return res.status(404).json({ error: "Target category not found" });

  const found = await prisma.category.findMany({
    where: { id: { in: sources } },
    select: { id: true, name: true },
  });
  if (found.length === 0) return res.status(404).json({ error: "No matching categories to merge" });
  const ids = found.map((c) => c.id);

  const movedTransactions = await prisma.transaction.count({ where: { categoryId: { in: ids } } });
  const movedRecurring = await prisma.recurringTransaction.count({ where: { categoryId: { in: ids } } });

  // The target loses its parent when that parent is being merged away, so it
  // becomes top-level. Reported back so the UI can say so plainly.
  const detachedTarget = !!target.parentId && ids.includes(target.parentId);

  await prisma.$transaction([
    // Detach the target first if it sits under a category being merged away,
    // otherwise the reparent below would make it its own parent.
    prisma.category.updateMany({
      where: { id: targetId, parentId: { in: ids } },
      data: { parentId: null },
    }),
    // Sub-categories of the merged categories move under the target
    prisma.category.updateMany({ where: { parentId: { in: ids } }, data: { parentId: targetId } }),
    prisma.transaction.updateMany({ where: { categoryId: { in: ids } }, data: { categoryId: targetId } }),
    prisma.recurringTransaction.updateMany({ where: { categoryId: { in: ids } }, data: { categoryId: targetId } }),
    prisma.category.deleteMany({ where: { id: { in: ids } } }),
  ]);

  res.json({
    merged: ids.length,
    mergedNames: found.map((c) => c.name),
    target: target.name,
    movedTransactions,
    movedRecurring,
    detachedTarget,
  });
});

router.post("/", async (req, res) => {
  const { name, color, icon, parentId } = req.body;
  const category = await prisma.category.create({
    data: { name, color, icon, parentId: parentId || null },
  });
  res.status(201).json(category);
});

router.put("/:id", async (req, res) => {
  const { name, color, icon } = req.body;
  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: { name, color, icon },
  });
  res.json(category);
});

router.delete("/:id", async (req, res) => {
  // Unlink transactions before deleting
  await prisma.transaction.updateMany({
    where: { categoryId: req.params.id },
    data: { categoryId: null },
  });
  await prisma.category.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// POST /categories/seed — create standard categories, skip existing names
const STANDARD_CATEGORIES = [
  { name: "Income",        icon: "💰", color: "#10b981", children: [
    { name: "Salary",          icon: "💼", color: "#10b981" },
    { name: "Freelance",       icon: "🖥️", color: "#10b981" },
    { name: "Investments",     icon: "📈", color: "#10b981" },
    { name: "Gifts received",  icon: "🎁", color: "#10b981" },
    { name: "Other income",    icon: "💵", color: "#10b981" },
  ]},
  { name: "Housing",       icon: "🏠", color: "#6366f1", children: [
    { name: "Rent / Mortgage", icon: "🏠", color: "#6366f1" },
    { name: "Utilities",       icon: "⚡", color: "#6366f1" },
    { name: "Internet",        icon: "📡", color: "#6366f1" },
    { name: "Home insurance",  icon: "🔒", color: "#6366f1" },
    { name: "Maintenance",     icon: "🔧", color: "#6366f1" },
  ]},
  { name: "Food & Dining", icon: "🍔", color: "#f59e0b", children: [
    { name: "Groceries",       icon: "🛒", color: "#f59e0b" },
    { name: "Restaurants",     icon: "🍽️", color: "#f59e0b" },
    { name: "Coffee & Cafes",  icon: "☕", color: "#f59e0b" },
    { name: "Takeaway",        icon: "🥡", color: "#f59e0b" },
  ]},
  { name: "Transport",     icon: "🚗", color: "#3b82f6", children: [
    { name: "Fuel",            icon: "⛽", color: "#3b82f6" },
    { name: "Public transport",icon: "🚌", color: "#3b82f6" },
    { name: "Parking",         icon: "🅿️", color: "#3b82f6" },
    { name: "Car insurance",   icon: "🚘", color: "#3b82f6" },
    { name: "Car maintenance", icon: "🔧", color: "#3b82f6" },
  ]},
  { name: "Health",        icon: "💊", color: "#ec4899", children: [
    { name: "Doctor",          icon: "🩺", color: "#ec4899" },
    { name: "Pharmacy",        icon: "💊", color: "#ec4899" },
    { name: "Gym & Fitness",   icon: "💪", color: "#ec4899" },
    { name: "Health insurance",icon: "🏥", color: "#ec4899" },
  ]},
  { name: "Entertainment", icon: "🎬", color: "#8b5cf6", children: [
    { name: "Streaming",       icon: "📺", color: "#8b5cf6" },
    { name: "Movies & Events", icon: "🎟️", color: "#8b5cf6" },
    { name: "Games",           icon: "🎮", color: "#8b5cf6" },
    { name: "Hobbies",         icon: "🎨", color: "#8b5cf6" },
  ]},
  { name: "Shopping",      icon: "🛍️", color: "#f97316", children: [
    { name: "Clothing",        icon: "👕", color: "#f97316" },
    { name: "Electronics",     icon: "📱", color: "#f97316" },
    { name: "Personal care",   icon: "🧴", color: "#f97316" },
  ]},
  { name: "Education",     icon: "🎓", color: "#06b6d4", children: [
    { name: "Courses",         icon: "📚", color: "#06b6d4" },
    { name: "Books",           icon: "📖", color: "#06b6d4" },
    { name: "Subscriptions",   icon: "📰", color: "#06b6d4" },
  ]},
  { name: "Travel",        icon: "✈️", color: "#14b8a6", children: [
    { name: "Flights",         icon: "✈️", color: "#14b8a6" },
    { name: "Hotels",          icon: "🏨", color: "#14b8a6" },
    { name: "Activities",      icon: "🗺️", color: "#14b8a6" },
  ]},
  { name: "Finance",       icon: "🏦", color: "#ef4444", children: [
    { name: "Bank fees",       icon: "🏦", color: "#ef4444" },
    { name: "Taxes",           icon: "🧾", color: "#ef4444" },
    { name: "Savings transfer",icon: "💸", color: "#ef4444" },
  ]},
];

router.post("/seed", async (req, res) => {
  const existing = await prisma.category.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((c) => c.name));

  let created = 0;
  for (const parent of STANDARD_CATEGORIES) {
    let parentRecord;
    if (existingNames.has(parent.name)) {
      parentRecord = await prisma.category.findUnique({ where: { name: parent.name } });
    } else {
      parentRecord = await prisma.category.create({
        data: { name: parent.name, icon: parent.icon, color: parent.color },
      });
      created++;
    }

    for (const child of parent.children || []) {
      if (!existingNames.has(child.name)) {
        await prisma.category.create({
          data: { name: child.name, icon: child.icon, color: child.color, parentId: parentRecord.id },
        });
        created++;
      }
    }
  }

  res.json({ created, message: `${created} categories added` });
});

module.exports = router;
