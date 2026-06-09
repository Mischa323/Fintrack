const express = require("express");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

// All routes in this file require admin — applied in index.js via authMiddleware + requireAdmin

// GET /users
router.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, email: true, role: true, twoFactorEnabled: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

// POST /users — admin creates a new user
router.post("/", async (req, res) => {
  const { username, password, role = "user" } = req.body;
  if (!username || username.trim().length < 2) return res.status(400).json({ error: "Username must be at least 2 characters" });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!["admin", "user"].includes(role)) return res.status(400).json({ error: "Role must be admin or user" });

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) return res.status(409).json({ error: "Username already taken" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username: username.trim(), passwordHash, role },
    select: { id: true, username: true, role: true, createdAt: true },
  });
  res.status(201).json(user);
});

// PUT /users/:id — change role or reset password
router.put("/:id", async (req, res) => {
  const { role, password } = req.body;
  const data = {};

  if (role !== undefined) {
    if (!["admin", "user"].includes(role)) return res.status(400).json({ error: "Role must be admin or user" });
    // Prevent last admin from being demoted
    if (role === "user") {
      const adminCount = await prisma.user.count({ where: { role: "admin" } });
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (target?.role === "admin" && adminCount <= 1) {
        return res.status(400).json({ error: "Cannot demote the last admin" });
      }
    }
    data.role = role;
  }

  if (password !== undefined) {
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    data.passwordHash = await bcrypt.hash(password, 12);
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, username: true, role: true, createdAt: true },
  });
  res.json(user);
});

// DELETE /users/:id
router.delete("/:id", async (req, res) => {
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found" });

  if (target.role === "admin") {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) return res.status(400).json({ error: "Cannot delete the last admin" });
  }

  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
