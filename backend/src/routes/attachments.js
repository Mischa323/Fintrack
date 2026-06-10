const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

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
        select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
      })
    )
  );

  res.status(201).json(created);
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
