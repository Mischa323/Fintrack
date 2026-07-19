const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

let cachedSecret = null;

// Resolve the JWT signing secret, generating and persisting one on first run.
// Precedence:
//   1. JWT_SECRET env var  — explicit external override (optional)
//   2. Settings.jwtSecret  — stored in the DB (survives redeploys via the volume)
//   3. freshly generated   — random 48-byte secret, persisted to Settings
async function initJwtSecret() {
  if (process.env.JWT_SECRET) {
    cachedSecret = process.env.JWT_SECRET;
    return cachedSecret;
  }

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  if (settings.jwtSecret) {
    cachedSecret = settings.jwtSecret;
    return cachedSecret;
  }

  const generated = crypto.randomBytes(48).toString("hex");
  await prisma.settings.update({
    where: { id: "singleton" },
    data: { jwtSecret: generated },
  });
  cachedSecret = generated;
  console.log("Generated a new JWT secret and stored it in Settings.");
  return cachedSecret;
}

function getJwtSecret() {
  if (!cachedSecret) {
    throw new Error("JWT secret not initialized — call initJwtSecret() at startup");
  }
  return cachedSecret;
}

module.exports = { initJwtSecret, getJwtSecret };
