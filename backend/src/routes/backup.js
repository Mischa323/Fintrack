const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { runBackup, getDbPath } = require("../services/backupService");

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ dest: path.join(__dirname, "../../uploads") });

// GET /backup
router.get("/", async (req, res) => {
  const configs = await prisma.backupConfig.findMany({ orderBy: { createdAt: "asc" } });
  res.json(configs);
});

// POST /backup
router.post("/", async (req, res) => {
  const { label, type, configJson, schedule, enabled } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
  if (!["smb", "sftp", "onedrive", "googledrive"].includes(type))
    return res.status(400).json({ error: "Invalid type" });

  const cfg = await prisma.backupConfig.create({
    data: {
      label: label.trim(),
      type,
      configJson: typeof configJson === "string" ? configJson : JSON.stringify(configJson || {}),
      schedule: schedule || "0 2 * * *",
      enabled: enabled !== false,
    },
  });
  res.json(cfg);
});

// PUT /backup/:id
router.put("/:id", async (req, res) => {
  const { label, configJson, schedule, enabled } = req.body;
  const data = {};
  if (label !== undefined) data.label = label.trim();
  if (configJson !== undefined)
    data.configJson = typeof configJson === "string" ? configJson : JSON.stringify(configJson);
  if (schedule !== undefined) data.schedule = schedule;
  if (enabled !== undefined) data.enabled = Boolean(enabled);

  const cfg = await prisma.backupConfig.update({ where: { id: req.params.id }, data });
  res.json(cfg);
});

// DELETE /backup/:id
router.delete("/:id", async (req, res) => {
  await prisma.backupConfig.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// POST /backup/run — manual trigger
router.post("/run", async (req, res) => {
  runBackup().catch(console.error);
  res.json({ ok: true, message: "Backup started in background" });
});

// GET /backup/download — download current database as a file
router.get("/download", async (req, res) => {
  const dbPath = path.resolve(path.join(__dirname, "../../"), getDbPath());
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  res.download(dbPath, `fintrack-backup-${ts}.db`);
});

// POST /backup/restore — restore database from uploaded .db file
router.post("/restore", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No backup file provided" });
  const uploadedPath = req.file.path;
  try {
    const dbPath = path.resolve(path.join(__dirname, "../../"), getDbPath());
    await prisma.$disconnect();
    fs.copyFileSync(uploadedPath, dbPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(uploadedPath); } catch {}
  }
});

module.exports = router;
