const express = require("express");
const { PrismaClient } = require("@prisma/client");

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
  } = req.body;
  const data = {};
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

module.exports = router;
