const crypto = require("crypto");
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { clearAll } = require("../services/loginGuard");

const router = express.Router();
const prisma = new PrismaClient();

async function getSettings() {
  return prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

// GET /config
router.get("/", async (req, res) => {
  const s = await getSettings();
  res.json({
    appName: s.appName,
    defaultCurrency: s.defaultCurrency,
    appPort: s.appPort ?? parseInt(process.env.PORT) ?? 3001,
    hasCustomJwtSecret: !!s.jwtSecret,
    transferDetection: s.transferDetection || "confirm",
    loginBlockEnabled: s.loginBlockEnabled !== false,
    loginMaxAttempts: s.loginMaxAttempts ?? 5,
    loginBlockMinutes: s.loginBlockMinutes ?? 15,
    // Only whether a diagnostics key is live and until when — never the key
    diagnosticsKeyExpiresAt: s.diagnosticsKeyHash && s.diagnosticsKeyExpiresAt && new Date(s.diagnosticsKeyExpiresAt) > new Date()
      ? s.diagnosticsKeyExpiresAt : null,
    aiUrl: s.aiUrl ?? "",
    aiModel: s.aiModel ?? "",
    aiVisionModel: s.aiVisionModel ?? "",
    aiLanguage: s.aiLanguage ?? "",
    oidcEnabled: s.oidcEnabled,
    oidcTenantId: s.oidcTenantId ?? "",
    oidcClientId: s.oidcClientId ?? "",
    hasOidcClientSecret: !!s.oidcClientSecret,
    googleOidcEnabled: s.googleOidcEnabled,
    googleClientId: s.googleClientId ?? "",
    hasGoogleClientSecret: !!s.googleClientSecret,
  });
});

// PUT /config
router.put("/", async (req, res) => {
  const {
    appName, defaultCurrency, appPort, jwtSecret, transferDetection, aiUrl, aiModel, aiVisionModel, aiLanguage,
    oidcEnabled, oidcTenantId, oidcClientId, oidcClientSecret,
    googleOidcEnabled, googleClientId, googleClientSecret,
    loginBlockEnabled, loginMaxAttempts, loginBlockMinutes,
  } = req.body;
  const data = {};
  if (loginBlockEnabled !== undefined) data.loginBlockEnabled = Boolean(loginBlockEnabled);
  if (loginMaxAttempts !== undefined) data.loginMaxAttempts = Math.min(100, Math.max(1, parseInt(loginMaxAttempts) || 5));
  if (loginBlockMinutes !== undefined) data.loginBlockMinutes = Math.min(1440, Math.max(1, parseInt(loginBlockMinutes) || 15));
  if (appName !== undefined) data.appName = String(appName).trim() || "FinTrack";
  if (defaultCurrency !== undefined) data.defaultCurrency = String(defaultCurrency).trim().toUpperCase() || "EUR";
  if (appPort !== undefined) data.appPort = parseInt(appPort) || null;
  if (jwtSecret !== undefined) data.jwtSecret = jwtSecret || null;
  if (aiUrl !== undefined) data.aiUrl = aiUrl || null;
  if (aiModel !== undefined) data.aiModel = aiModel || null;
  if (aiVisionModel !== undefined) data.aiVisionModel = aiVisionModel || null;
  if (aiLanguage !== undefined) data.aiLanguage = aiLanguage || null;
  if (transferDetection !== undefined && ["off","auto","confirm"].includes(transferDetection)) data.transferDetection = transferDetection;
  if (oidcEnabled !== undefined) data.oidcEnabled = Boolean(oidcEnabled);
  if (oidcTenantId !== undefined) data.oidcTenantId = oidcTenantId || null;
  if (oidcClientId !== undefined) data.oidcClientId = oidcClientId || null;
  if (oidcClientSecret !== undefined) data.oidcClientSecret = oidcClientSecret || null;
  if (googleOidcEnabled !== undefined) data.googleOidcEnabled = Boolean(googleOidcEnabled);
  if (googleClientId !== undefined) data.googleClientId = googleClientId || null;
  if (googleClientSecret !== undefined) data.googleClientSecret = googleClientSecret || null;

  await prisma.settings.update({ where: { id: "singleton" }, data });
  res.json({ ok: true, note: "Port and JWT secret changes take effect after restart" });
});

// POST /config/login-blocks/clear — lift every IP block/counter (recovery if you
// locked yourself out and are still signed in elsewhere).
router.post("/login-blocks/clear", async (req, res) => {
  const cleared = await clearAll();
  res.json({ cleared });
});

// POST /config/diagnostics-key { hours } — create a temporary read-only key for
// /diagnostics. The plaintext is returned once; only its SHA-256 is stored.
// Creating a new key replaces the previous one.
router.post("/diagnostics-key", async (req, res) => {
  const hours = Math.min(168, Math.max(1, parseInt(req.body?.hours) || 24));
  const key = `ftd_${crypto.randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await prisma.settings.update({
    where: { id: "singleton" },
    data: { diagnosticsKeyHash: crypto.createHash("sha256").update(key).digest("hex"), diagnosticsKeyExpiresAt: expiresAt },
  });
  res.json({ key, expiresAt });
});

// DELETE /config/diagnostics-key — revoke it immediately
router.delete("/diagnostics-key", async (req, res) => {
  await prisma.settings.update({ where: { id: "singleton" }, data: { diagnosticsKeyHash: null, diagnosticsKeyExpiresAt: null } });
  res.json({ revoked: true });
});

module.exports = router;
