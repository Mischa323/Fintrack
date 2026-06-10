const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { loadAiConfig, tagStoredAttachment } = require("../services/aiTagging");

const router = express.Router();
const prisma = new PrismaClient();

const ATT_SELECT = { id: true, filename: true, mimeType: true, size: true, tags: true, createdAt: true };

const UPLOAD_DIR = path.join(__dirname, "../../uploads/attachments");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/heic",
  "application/pdf",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// POST /transactions/:id/attachments — upload one or more receipts/invoices
router.post("/transactions/:id/attachments", upload.array("files"), async (req, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction) {
    (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
    return res.status(404).json({ error: "Transaction not found" });
  }

  const created = await Promise.all(
    (req.files || []).map((f) =>
      prisma.attachment.create({
        data: {
          transactionId: transaction.id,
          filename: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
          storagePath: path.basename(f.path),
        },
        select: { ...ATT_SELECT, storagePath: true },
      })
    )
  );

  // Best-effort AI tagging — never fails the upload.
  const aiConfig = await loadAiConfig().catch(() => null);
  if (aiConfig) {
    await Promise.all(
      created.map(async (att) => {
        try {
          att.tags = JSON.stringify(await tagStoredAttachment(att, aiConfig));
        } catch (e) {
          console.error(`AI tagging failed for attachment ${att.id}:`, e.message);
        }
      })
    );
  }

  res.status(201).json(created.map(({ storagePath, ...rest }) => rest));
});

// POST /transactions/:id/attachments/retag — re-run AI tagging on all of a transaction's attachments
router.post("/transactions/:id/attachments/retag", async (req, res) => {
  const aiConfig = await loadAiConfig();
  if (!aiConfig) return res.status(400).json({ error: "AI tagging is not enabled" });

  const attachments = await prisma.attachment.findMany({ where: { transactionId: req.params.id } });
  const results = await Promise.all(
    attachments.map(async (att) => {
      try {
        const tags = await tagStoredAttachment(att, aiConfig);
        return { id: att.id, filename: att.filename, mimeType: att.mimeType, size: att.size, tags: JSON.stringify(tags), createdAt: att.createdAt };
      } catch (e) {
        return { id: att.id, filename: att.filename, mimeType: att.mimeType, size: att.size, tags: att.tags, createdAt: att.createdAt, error: e.message };
      }
    })
  );
  res.json(results);
});

// GET /attachments/:id — stream the stored file for inline viewing
router.get("/attachments/:id", async (req, res) => {
  const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (!att) return res.status(404).json({ error: "Attachment not found" });

  const filePath = path.join(UPLOAD_DIR, att.storagePath);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });

  res.setHeader("Content-Type", att.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});

// DELETE /attachments/:id — remove an attachment and its file
router.delete("/attachments/:id", async (req, res) => {
  const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (!att) return res.status(404).json({ error: "Attachment not found" });

  await prisma.attachment.delete({ where: { id: att.id } });
  fs.unlink(path.join(UPLOAD_DIR, att.storagePath), () => {});

  res.status(204).end();
});

module.exports = router;
