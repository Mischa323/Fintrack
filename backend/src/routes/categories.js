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

module.exports = router;
