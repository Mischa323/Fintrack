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
    oidcEnabled: s.oidcEnabled,
    oidcTenantId: s.oidcTenantId ?? "",
    oidcClientId: s.oidcClientId ?? "",
    hasOidcClientSecret: !!s.oidcClientSecret,
    googleOidcEnabled: s.googleOidcEnabled,
    googleClientId: s.googleClientId ?? "",
    hasGoogleClientSecret: !!s.googleClientSecret,
    aiTaggingEnabled: s.aiTaggingEnabled,
    aiProvider: s.aiProvider ?? "claude",
    aiModel: s.aiModel ?? "",
    hasAnthropicApiKey: !!(s.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    odysseusBaseUrl: s.odysseusBaseUrl ?? "",
    hasOdysseusApiKey: !!s.odysseusApiKey,
  });
});

// PUT /config
router.put("/", async (req, res) => {
  const {
    appName, defaultCurrency, appPort, jwtSecret,
    oidcEnabled, oidcTenantId, oidcClientId, oidcClientSecret,
    googleOidcEnabled, googleClientId, googleClientSecret,
    aiTaggingEnabled, aiProvider, aiModel, anthropicApiKey, odysseusBaseUrl, odysseusApiKey,
  } = req.body;
  const data = {};
  if (appName !== undefined) data.appName = String(appName).trim() || "FinTrack";
  if (defaultCurrency !== undefined) data.defaultCurrency = String(defaultCurrency).trim().toUpperCase() || "EUR";
  if (appPort !== undefined) data.appPort = parseInt(appPort) || null;
  if (jwtSecret !== undefined) data.jwtSecret = jwtSecret || null;
  if (oidcEnabled !== undefined) data.oidcEnabled = Boolean(oidcEnabled);
  if (oidcTenantId !== undefined) data.oidcTenantId = oidcTenantId || null;
  if (oidcClientId !== undefined) data.oidcClientId = oidcClientId || null;
  if (oidcClientSecret !== undefined) data.oidcClientSecret = oidcClientSecret || null;
  if (googleOidcEnabled !== undefined) data.googleOidcEnabled = Boolean(googleOidcEnabled);
  if (googleClientId !== undefined) data.googleClientId = googleClientId || null;
  if (googleClientSecret !== undefined) data.googleClientSecret = googleClientSecret || null;
  if (aiTaggingEnabled !== undefined) data.aiTaggingEnabled = Boolean(aiTaggingEnabled);
  if (aiProvider !== undefined) data.aiProvider = ["claude", "odysseus"].includes(aiProvider) ? aiProvider : "claude";
  if (aiModel !== undefined) data.aiModel = aiModel || null;
  if (anthropicApiKey !== undefined) data.anthropicApiKey = anthropicApiKey || null;
  if (odysseusBaseUrl !== undefined) data.odysseusBaseUrl = odysseusBaseUrl || null;
  if (odysseusApiKey !== undefined) data.odysseusApiKey = odysseusApiKey || null;

  await prisma.settings.update({ where: { id: "singleton" }, data });
  res.json({ ok: true, note: "Port and JWT secret changes take effect after restart" });
});

module.exports = router;
