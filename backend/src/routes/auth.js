const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { Issuer, generators } = require("openid-client");
const { PrismaClient } = require("@prisma/client");
const authMiddleware = require("../middleware/auth");
const { getJwtSecret } = require("../services/jwtSecret");

const router = express.Router();
const prisma = new PrismaClient();

const APP_NAME = "FinTrack";

const oidcClientCache = new Map();
const googleClientCache = new Map();

function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

async function getSettings() {
  return prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

// ── Public routes ─────────────────────────────────────────────

// GET /auth/status
router.get("/status", async (req, res) => {
  const count = await prisma.user.count();
  const s = await getSettings();
  res.json({
    isSetup: count > 0,
    oidcEnabled: s.oidcEnabled && !!s.oidcTenantId && !!s.oidcClientId,
    googleOidcEnabled: s.googleOidcEnabled && !!s.googleClientId && !!s.googleClientSecret,
  });
});

// POST /auth/setup — create the first admin account
router.post("/setup", async (req, res) => {
  const { username, password } = req.body;
  const count = await prisma.user.count();
  if (count > 0) return res.status(400).json({ error: "App is already set up" });
  if (!username || username.trim().length < 2) return res.status(400).json({ error: "Username must be at least 2 characters" });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username: username.trim(), passwordHash, role: "admin" },
  });
  res.json({ token: signToken(user) });
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { username, password, totpCode } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.passwordHash) return res.status(401).json({ error: "Invalid username or password" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid username or password" });

  if (user.twoFactorEnabled) {
    if (!totpCode) return res.status(200).json({ requires2FA: true });
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: totpCode,
      window: 1,
    });
    if (!verified) return res.status(401).json({ error: "Invalid 2FA code" });
  }

  res.json({ token: signToken(user) });
});

// ── Authenticated routes (require valid JWT) ──────────────────

// POST /auth/change-password
router.post("/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user.passwordHash) return res.status(400).json({ error: "No password set on this account" });

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Incorrect current password" });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

// POST /auth/2fa/generate
router.post("/2fa/generate", authMiddleware, async (req, res) => {
  const secret = speakeasy.generateSecret({ name: `${APP_NAME} (${req.user.username})`, length: 20 });
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  await prisma.user.update({
    where: { id: req.user.userId },
    data: { twoFactorSecret: secret.base32 },
  });
  res.json({ secret: secret.base32, qrCode: qrDataUrl });
});

// POST /auth/2fa/enable
router.post("/2fa/enable", authMiddleware, async (req, res) => {
  const { totpCode } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user.twoFactorSecret) return res.status(400).json({ error: "Generate a 2FA secret first" });

  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: "base32",
    token: totpCode,
    window: 1,
  });
  if (!verified) return res.status(400).json({ error: "Invalid code — try again" });
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  res.json({ ok: true });
});

// POST /auth/2fa/disable
router.post("/2fa/disable", authMiddleware, async (req, res) => {
  const { password } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Incorrect password" });

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  res.json({ ok: true });
});

// GET /auth/me — current user info
router.get("/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, username: true, email: true, role: true, twoFactorEnabled: true, createdAt: true },
  });
  res.json(user);
});

// ── OIDC / Microsoft SSO ──────────────────────────────────────

async function getOidcClient(s) {
  const tenantId = s.oidcTenantId;
  if (!tenantId || !s.oidcClientId || !s.oidcClientSecret) return null;
  if (oidcClientCache.has(tenantId)) return oidcClientCache.get(tenantId);

  const issuer = await Issuer.discover(`https://login.microsoftonline.com/${tenantId}/v2.0`);
  const client = new issuer.Client({
    client_id: s.oidcClientId,
    client_secret: s.oidcClientSecret,
    redirect_uris: [getCallbackUrl()],
    response_types: ["code"],
  });
  oidcClientCache.set(tenantId, client);
  return client;
}

function getCallbackUrl() {
  return `${process.env.APP_URL || "http://localhost:3001"}/auth/oidc/callback`;
}

function getFrontendUrl() {
  return process.env.FRONTEND_URL || "http://localhost:5173";
}

router.get("/oidc/login", async (req, res) => {
  const s = await getSettings();
  const client = await getOidcClient(s);
  if (!client) return res.status(400).json({ error: "SSO is not configured" });

  const state = generators.state();
  const nonce = generators.nonce();
  res.cookie("oidc_state", state, { httpOnly: true, maxAge: 5 * 60 * 1000, sameSite: "lax" });
  res.cookie("oidc_nonce", nonce, { httpOnly: true, maxAge: 5 * 60 * 1000, sameSite: "lax" });
  res.redirect(client.authorizationUrl({ scope: "openid email profile", state, nonce }));
});

router.get("/oidc/callback", async (req, res) => {
  const s = await getSettings();
  const client = await getOidcClient(s);
  const frontendUrl = getFrontendUrl();
  if (!client) return res.redirect(`${frontendUrl}/login?error=sso_not_configured`);

  const state = req.cookies?.oidc_state;
  const nonce = req.cookies?.oidc_nonce;
  res.clearCookie("oidc_state");
  res.clearCookie("oidc_nonce");

  try {
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(getCallbackUrl(), params, { state, nonce });
    const claims = tokenSet.claims();

    // Find or create user by OIDC subject
    const subject = claims.sub;
    const email = claims.email || null;
    const username = claims.preferred_username || claims.email?.split("@")[0] || subject;

    let user = await prisma.user.findUnique({ where: { oidcSubject: subject } });
    if (!user) {
      const isFirst = (await prisma.user.count()) === 0;
      user = await prisma.user.create({
        data: {
          username: username.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 32),
          email,
          oidcSubject: subject,
          role: isFirst ? "admin" : "user",
        },
      });
    }

    const token = signToken(user);
    res.redirect(`${frontendUrl}/login?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("OIDC callback error:", err.message);
    res.redirect(`${frontendUrl}/login?error=sso_failed`);
  }
});

// ── OIDC / Google SSO ─────────────────────────────────────────

async function getGoogleClient(s) {
  if (!s.googleClientId || !s.googleClientSecret) return null;
  const cacheKey = s.googleClientId;
  if (googleClientCache.has(cacheKey)) return googleClientCache.get(cacheKey);

  const issuer = await Issuer.discover("https://accounts.google.com");
  const client = new issuer.Client({
    client_id: s.googleClientId,
    client_secret: s.googleClientSecret,
    redirect_uris: [getGoogleCallbackUrl()],
    response_types: ["code"],
  });
  googleClientCache.set(cacheKey, client);
  return client;
}

function getGoogleCallbackUrl() {
  return `${process.env.APP_URL || "http://localhost:3001"}/auth/google/callback`;
}

router.get("/google/login", async (req, res) => {
  const s = await getSettings();
  const client = await getGoogleClient(s);
  if (!client) return res.status(400).json({ error: "Google SSO is not configured" });

  const state = generators.state();
  const nonce = generators.nonce();
  res.cookie("google_oidc_state", state, { httpOnly: true, maxAge: 5 * 60 * 1000, sameSite: "lax" });
  res.cookie("google_oidc_nonce", nonce, { httpOnly: true, maxAge: 5 * 60 * 1000, sameSite: "lax" });
  res.redirect(client.authorizationUrl({ scope: "openid email profile", state, nonce }));
});

router.get("/google/callback", async (req, res) => {
  const s = await getSettings();
  const client = await getGoogleClient(s);
  const frontendUrl = getFrontendUrl();
  if (!client) return res.redirect(`${frontendUrl}/login?error=google_sso_not_configured`);

  const state = req.cookies?.google_oidc_state;
  const nonce = req.cookies?.google_oidc_nonce;
  res.clearCookie("google_oidc_state");
  res.clearCookie("google_oidc_nonce");

  try {
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(getGoogleCallbackUrl(), params, { state, nonce });
    const claims = tokenSet.claims();

    const subject = claims.sub;
    const email = claims.email || null;
    const username = (claims.name || claims.email?.split("@")[0] || subject)
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(0, 32);

    let user = await prisma.user.findUnique({ where: { googleOidcSubject: subject } });
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.user.update({ where: { id: user.id }, data: { googleOidcSubject: subject } });
      }
    }
    if (!user) {
      const isFirst = (await prisma.user.count()) === 0;
      user = await prisma.user.create({
        data: {
          username,
          email,
          googleOidcSubject: subject,
          role: isFirst ? "admin" : "user",
        },
      });
    }

    const token = signToken(user);
    res.redirect(`${frontendUrl}/login?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("Google OIDC callback error:", err.message);
    res.redirect(`${frontendUrl}/login?error=google_sso_failed`);
  }
});

module.exports = router;
