const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { getJwtSecret } = require("../services/jwtSecret");
const diag = require("../services/diagnostics");

const router = express.Router();
const prisma = new PrismaClient();

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest();

// Read-only access for troubleshooting. Accepts either a normal signed-in
// session (Bearer JWT) or a temporary diagnostics key created in Settings
// (X-Diagnostics-Key). The key is stored only as a SHA-256 hash, expires on its
// own and can be revoked; this router defines GET routes only, so a leaked key
// can read but never change anything.
async function diagnosticsAuth(req, res, next) {
  const key = req.headers["x-diagnostics-key"];
  if (key) {
    const s = await prisma.settings.findUnique({ where: { id: "singleton" } });
    const valid = s?.diagnosticsKeyHash
      && s.diagnosticsKeyExpiresAt && new Date(s.diagnosticsKeyExpiresAt) > new Date()
      && crypto.timingSafeEqual(sha256(key), Buffer.from(s.diagnosticsKeyHash, "hex"));
    if (!valid) return res.status(401).json({ error: "Invalid, revoked or expired diagnostics key" });
    req.diagnosticsViaKey = true;
    return next();
  }
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), getJwtSecret());
      return next();
    } catch {}
  }
  res.status(401).json({ error: "Sign in, or send a diagnostics key in X-Diagnostics-Key" });
}

router.use(diagnosticsAuth);
router.use((req, res, next) => (req.method === "GET" ? next() : res.status(405).json({ error: "Diagnostics is read-only" })));

// GET /diagnostics — what's available
router.get("/", (req, res) => {
  res.json({
    readOnly: true,
    endpoints: {
      "/diagnostics/summary": "Per-account balance check, sources, anomalies + plain-language findings",
      "/diagnostics/imports?accountId=": "Import runs per account and source (rows, date span, sums)",
      "/diagnostics/duplicates?accountId=&limit=": "Exact duplicates and cross-source twins",
      "/diagnostics/transfers?limit=": "Expense/income pairs between own accounts that look like unlinked transfers, plus transfers also stored as a loose income/expense row (counted twice)",
      "/diagnostics/transactions?accountId=&from=&to=&q=&source=&type=&limit=&offset=": "Raw rows incl. externalId, source, createdAt",
      "/diagnostics/report?accountId=": "Everything above in one document",
    },
  });
});

router.get("/summary", async (req, res) => {
  const data = await diag.loadAll();
  const summaries = diag.accountSummaries(data);
  const dupes = diag.exactDuplicates(data.transactions);
  const cross = diag.crossSourceDuplicates(data.transactions);
  const transfers = diag.unlinkedTransfers(data);
  const mirrors = diag.transferMirrors(data);
  res.json({
    generatedAt: new Date().toISOString(),
    counts: { accounts: data.accounts.length, transactions: data.transactions.length },
    findings: diag.findings(summaries, dupes, cross, transfers, mirrors),
    accounts: summaries,
  });
});

router.get("/imports", async (req, res) => {
  const { transactions } = await diag.loadAll();
  res.json(diag.importBatches(transactions, req.query.accountId || null));
});

router.get("/duplicates", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const { transactions } = await diag.loadAll();
  const accountId = req.query.accountId || null;
  const exact = diag.exactDuplicates(transactions, accountId);
  const cross = diag.crossSourceDuplicates(transactions, accountId);
  res.json({ exactCount: exact.length, crossSourceCount: cross.length, exact: exact.slice(0, limit), crossSource: cross.slice(0, limit) });
});

router.get("/transfers", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const data = await diag.loadAll();
  const pairs = diag.unlinkedTransfers(data);
  const mirrors = diag.transferMirrors(data);
  res.json({ count: pairs.length, pairs: pairs.slice(0, limit), mirrorCount: mirrors.length, mirrors: mirrors.slice(0, limit) });
});

router.get("/transactions", async (req, res) => {
  const { accountId, from, to, q, source, type } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = {};
  if (accountId) where.OR = [{ accountId }, { toAccountId: accountId }];
  if (type) where.type = type;
  if (source) where.importedFrom = source === "manual" ? null : source;
  if (q) where.description = { contains: q };
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true, accountId: true, toAccountId: true, date: true, type: true, amount: true,
        description: true, notes: true, importedFrom: true, externalId: true,
        counterpartyIban: true, categoryId: true, createdAt: true,
        category: { select: { name: true } },
      },
    }),
  ]);
  res.json({ total, offset, limit, rows: rows.map((r) => ({ ...r, amount: Number(r.amount), category: r.category?.name || null })) });
});

router.get("/report", async (req, res) => {
  const report = await diag.buildReport({ accountId: req.query.accountId || null, limit: 2000 });
  if (req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename="fintrack-diagnostics-${report.generatedAt.slice(0, 10)}.json"`);
  }
  res.json(report);
});

module.exports = router;
