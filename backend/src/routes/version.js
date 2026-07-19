const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const pkg = require("../../package.json");

// Version of the newest published code, read straight from the repo.
const LATEST_URL =
  "https://raw.githubusercontent.com/Mischa323/Fintrack/master/backend/package.json";

// Written at image build time by the Dockerfile; absent in local dev.
function readBuildTime() {
  try {
    const value = fs.readFileSync(path.join(__dirname, "../../BUILD_TIME"), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function compareSemver(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// GET /version — what this install is running
router.get("/", (req, res) => {
  res.json({ version: pkg.version, buildTime: readBuildTime() });
});

// GET /version/check — compare against the latest published version
router.get("/check", async (req, res) => {
  const current = pkg.version;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(LATEST_URL, {
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const remote = await response.json();
    const latest = remote.version;
    res.json({ current, latest, updateAvailable: compareSemver(latest, current) > 0 });
  } catch (err) {
    const reason = err.name === "AbortError" ? "request timed out" : err.message;
    res.status(502).json({ current, error: `Could not reach GitHub: ${reason}` });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
