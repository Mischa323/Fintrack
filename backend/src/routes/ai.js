const express = require("express");
const {
  checkConnection, suggestForTransactions, applySuggestions, suggestCategoryMerges,
} = require("../services/ai");

const router = express.Router();

// GET /ai/status — is the configured Ollama reachable, and which models does it have
router.get("/status", async (req, res) => {
  res.json(await checkConnection());
});

// POST /ai/suggest — propose a category and a cleaned description per transaction.
// Nothing is written; the caller decides what to keep.
router.post("/suggest", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: "No transactions selected" });
  if (ids.length > 500) {
    return res.status(400).json({ error: "Select at most 500 transactions at a time" });
  }
  try {
    res.json(await suggestForTransactions(ids));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /ai/apply — write back exactly the changes that were confirmed
router.post("/apply", async (req, res) => {
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (changes.length === 0) return res.status(400).json({ error: "Nothing to apply" });
  res.json(await applySuggestions(changes));
});

// POST /ai/categories/suggest - which categories look like they belong together.
// Proposes only; merging still goes through POST /categories/merge.
router.post("/categories/suggest", async (req, res) => {
  try {
    res.json(await suggestCategoryMerges());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
