const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { extractFromImage, findMatches } = require("../services/receipts");
const { recalculateBalance } = require("../services/accountBalance");

const router = express.Router();
const prisma = new PrismaClient();

// Receipts are kept, not staged and deleted, so they live in their own folder
// inside the uploads volume.
const RECEIPT_DIR = path.join(__dirname, "../../uploads/receipts");
fs.mkdirSync(RECEIPT_DIR, { recursive: true });

const upload = multer({
  dest: RECEIPT_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    // A PDF would need rasterising first, which no dependency here does.
    cb(new Error("Only image files are supported — photograph or screenshot the document"));
  },
});

// GET /receipts — newest first, with whatever they were linked to
router.get("/", async (req, res) => {
  const { status } = req.query;
  const receipts = await prisma.receipt.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    include: {
      transaction: {
        select: {
          id: true, description: true, amount: true, date: true, type: true,
          account: { select: { id: true, name: true } },
        },
      },
    },
    take: 200,
  });
  res.json(receipts);
});

// GET /receipts/:id/image — the stored file itself
router.get("/:id/image", async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });
  const file = path.join(RECEIPT_DIR, receipt.storedName);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Image file is missing" });
  res.type(receipt.mimeType).sendFile(file);
});

// POST /receipts — upload an image, read it, and look for the transaction it
// belongs to. Nothing is linked or created here; the response is a proposal.
router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "An image file is required" });

  let extracted;
  try {
    const base64 = fs.readFileSync(req.file.path).toString("base64");
    extracted = await extractFromImage(base64);
  } catch (err) {
    // The upload is worthless without extraction, so do not keep the file
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: err.message });
  }

  const receipt = await prisma.receipt.create({
    data: {
      filename: req.file.originalname,
      storedName: path.basename(req.file.path),
      mimeType: req.file.mimetype,
      size: req.file.size,
      merchant: extracted.merchant,
      date: extracted.date,
      amount: extracted.amount,
      currency: extracted.currency,
      kind: extracted.kind,
      rawText: extracted.summary,
      status: "PENDING",
    },
  });

  const matches = await findMatches(extracted);
  res.status(201).json({ receipt, extracted, matches });
});

// POST /receipts/:id/link — attach this receipt to an existing transaction
router.post("/:id/link", async (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: "transactionId required" });

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction) return res.status(404).json({ error: "That transaction no longer exists" });

  const receipt = await prisma.receipt.update({
    where: { id: req.params.id },
    data: { transactionId, status: "MATCHED" },
    include: { transaction: true },
  });
  res.json(receipt);
});

// POST /receipts/:id/unlink — detach without deleting the image
router.post("/:id/unlink", async (req, res) => {
  const receipt = await prisma.receipt.update({
    where: { id: req.params.id },
    data: { transactionId: null, status: "PENDING" },
  });
  res.json(receipt);
});

// POST /receipts/:id/create-transaction — no transaction exists for this
// document, so record one from what was read and attach the receipt to it.
router.post("/:id/create-transaction", async (req, res) => {
  const { accountId, categoryId, description, amount, date, type } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId required" });

  const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });

  // The request wins over what was extracted, so a misread value can be
  // corrected in the review step before anything is written.
  const finalAmount = amount !== undefined ? Number(amount) : Number(receipt.amount);
  const finalType = type || (receipt.kind === "PAYSLIP" ? "INCOME" : "EXPENSE");
  const finalDate = date ? new Date(date) : receipt.date || new Date();
  const finalDescription = description || receipt.merchant || "Receipt";

  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    return res.status(400).json({ error: "A positive amount is required" });
  }
  if (!["INCOME", "EXPENSE"].includes(finalType)) {
    return res.status(400).json({ error: "type must be INCOME or EXPENSE" });
  }

  const transaction = await prisma.transaction.create({
    data: {
      accountId,
      categoryId: categoryId || null,
      amount: finalAmount,
      description: finalDescription,
      date: finalDate,
      type: finalType,
      notes: receipt.rawText || null,
    },
  });

  await prisma.receipt.update({
    where: { id: receipt.id },
    data: { transactionId: transaction.id, status: "CREATED" },
  });
  await recalculateBalance(accountId);

  res.status(201).json({ transaction });
});

// POST /receipts/:id/rematch — look again, e.g. after importing a statement
router.post("/:id/rematch", async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });

  const matches = await findMatches({
    merchant: receipt.merchant,
    date: receipt.date,
    amount: receipt.amount == null ? null : Number(receipt.amount),
    kind: receipt.kind,
  });
  res.json({ matches });
});

// POST /receipts/:id/dismiss — keep the image but stop offering matches
router.post("/:id/dismiss", async (req, res) => {
  const receipt = await prisma.receipt.update({
    where: { id: req.params.id },
    data: { status: "UNMATCHED" },
  });
  res.json(receipt);
});

router.delete("/:id", async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });
  try { fs.unlinkSync(path.join(RECEIPT_DIR, receipt.storedName)); } catch {}
  await prisma.receipt.delete({ where: { id: receipt.id } });
  res.status(204).end();
});

module.exports = router;
