const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Behind nginx the socket peer is the proxy, so the real client is in X-Real-IP
// (nginx sets it to $remote_addr). Fall back to X-Forwarded-For then the socket.
function getClientIp(req) {
  const realIp = req.headers["x-real-ip"];
  if (realIp) return String(realIp).split(",")[0].trim();
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

async function loadConfig() {
  const s = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return {
    enabled: s.loginBlockEnabled !== false,
    maxAttempts: Math.max(1, s.loginMaxAttempts || 5),
    blockMs: Math.max(1, s.loginBlockMinutes || 15) * 60 * 1000,
  };
}

// Is this IP currently blocked? { blocked, retryAfterSec }
async function checkBlocked(ip) {
  const cfg = await loadConfig();
  if (!cfg.enabled) return { blocked: false };
  const rec = await prisma.loginAttempt.findUnique({ where: { ip } });
  if (rec?.blockedUntil && new Date(rec.blockedUntil) > new Date()) {
    return { blocked: true, retryAfterSec: Math.ceil((new Date(rec.blockedUntil).getTime() - Date.now()) / 1000) };
  }
  return { blocked: false };
}

// Count a failed attempt; block the IP once the threshold is reached within the
// window. Failures outside the window start a fresh count.
async function recordFailure(ip) {
  const cfg = await loadConfig();
  if (!cfg.enabled) return { blocked: false };
  const now = new Date();
  const rec = await prisma.loginAttempt.findUnique({ where: { ip } });

  let failedCount = 1;
  let windowStart = now;
  if (rec) {
    const lapsed = now.getTime() - new Date(rec.windowStart).getTime() > cfg.blockMs;
    if (!lapsed) { failedCount = rec.failedCount + 1; windowStart = rec.windowStart; }
  }
  const willBlock = failedCount >= cfg.maxAttempts;
  const blockedUntil = willBlock ? new Date(now.getTime() + cfg.blockMs) : null;

  await prisma.loginAttempt.upsert({
    where: { ip },
    // On block, reset the counter and window so counting restarts once it lifts.
    update: { failedCount: willBlock ? 0 : failedCount, windowStart: willBlock ? now : windowStart, blockedUntil },
    create: { ip, failedCount, windowStart, blockedUntil },
  });

  return {
    blocked: willBlock,
    attemptsLeft: willBlock ? 0 : Math.max(0, cfg.maxAttempts - failedCount),
    retryAfterSec: willBlock ? Math.ceil(cfg.blockMs / 1000) : undefined,
  };
}

// Wipe an IP's counter after a successful login.
async function recordSuccess(ip) {
  await prisma.loginAttempt.deleteMany({ where: { ip } });
}

// Admin escape hatch: clear every block/counter (e.g. if you locked yourself out
// and are still signed in on another device).
async function clearAll() {
  const { count } = await prisma.loginAttempt.deleteMany({});
  return count;
}

module.exports = { getClientIp, checkBlocked, recordFailure, recordSuccess, clearAll };
