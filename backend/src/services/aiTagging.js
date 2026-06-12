const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const UPLOAD_DIR = path.join(__dirname, "../../uploads/attachments");

// Image mime types Claude's vision accepts. Anything else (incl. PDF) is handled separately.
const CLAUDE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

const PROMPT =
  "You are a finance assistant tagging a receipt or invoice so the user can search for it later. " +
  "Read the document and produce 3 to 8 short, lowercase search tags: the merchant or store name, " +
  "the spending category (e.g. groceries, fuel, software, restaurant), and a few notable line items or keywords. " +
  'Respond with ONLY a JSON array of strings and nothing else, e.g. ["albert heijn","groceries","coffee"].';

// Load and normalize AI config from the Settings singleton (env var is a fallback for the Anthropic key).
async function loadAiConfig() {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" } });
  if (!s || !s.aiTaggingEnabled) return null;
  return {
    enabled: true,
    provider: s.aiProvider || "claude",
    model: s.aiModel || null,
    anthropicApiKey: s.anthropicApiKey || process.env.ANTHROPIC_API_KEY || null,
    odysseusBaseUrl: (s.odysseusBaseUrl || "http://localhost:7000").replace(/\/+$/, ""),
    odysseusApiKey: s.odysseusApiKey || null,
  };
}

// Turn arbitrary model output into a clean, deduped tag list.
function parseTags(text) {
  if (!text) return [];
  let raw = [];
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try { raw = JSON.parse(match[0]); } catch { /* fall through */ }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    raw = text.split(/[\n,]+/);
  }
  const seen = new Set();
  const tags = [];
  for (const item of raw) {
    const t = String(item).trim().replace(/^["'\-•*\d.\s]+/, "").replace(/["']+$/, "").toLowerCase().trim();
    if (t && t.length <= 40 && !seen.has(t)) {
      seen.add(t);
      tags.push(t);
    }
    if (tags.length >= 10) break;
  }
  return tags;
}

async function tagWithClaude(buffer, mimeType, cfg) {
  if (!cfg.anthropicApiKey) throw new Error("Anthropic API key is not configured");
  const client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  const data = buffer.toString("base64");

  let fileBlock;
  if (CLAUDE_IMAGE_TYPES.has(mimeType)) {
    fileBlock = { type: "image", source: { type: "base64", media_type: mimeType === "image/jpg" ? "image/jpeg" : mimeType, data } };
  } else if (mimeType === "application/pdf") {
    fileBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  } else {
    return []; // unsupported type for vision — nothing to read
  }

  const response = await client.messages.create({
    model: cfg.model || "claude-haiku-4-5",
    max_tokens: 300,
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: PROMPT }] }],
  });

  const text = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return parseTags(text);
}

async function tagWithOdysseus(buffer, mimeType, filename, cfg) {
  if (!cfg.odysseusApiKey) throw new Error("Odysseus API token is not configured");
  const auth = { Authorization: `Bearer ${cfg.odysseusApiKey}` };

  // 1. Upload the file → get an attachment id
  const form = new FormData();
  form.append("files", new Blob([buffer], { type: mimeType }), filename);
  const upRes = await fetch(`${cfg.odysseusBaseUrl}/api/upload`, { method: "POST", headers: auth, body: form });
  if (!upRes.ok) throw new Error(`Odysseus upload failed (${upRes.status})`);
  const upJson = await upRes.json();
  const fileId = upJson?.files?.[0]?.id;
  if (!fileId) throw new Error("Odysseus upload returned no file id");

  // 2. Create a chat session
  const sessForm = new FormData();
  sessForm.append("name", "FinTrack tagging");
  if (cfg.model) sessForm.append("model", cfg.model);
  const sessRes = await fetch(`${cfg.odysseusBaseUrl}/api/session`, { method: "POST", headers: auth, body: sessForm });
  if (!sessRes.ok) throw new Error(`Odysseus session failed (${sessRes.status})`);
  const sessJson = await sessRes.json();
  const sessionId = sessJson?.id;
  if (!sessionId) throw new Error("Odysseus session returned no id");

  // 3. Ask for tags with the file attached
  const chatRes = await fetch(`${cfg.odysseusBaseUrl}/api/chat`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ message: PROMPT, session: sessionId, attachments: [fileId] }),
  });
  if (!chatRes.ok) throw new Error(`Odysseus chat failed (${chatRes.status})`);
  const chatJson = await chatRes.json();
  return parseTags(chatJson?.response || "");
}

// Generate tags for a single file buffer. Returns string[] (possibly empty); never throws to the caller
// unless `config` is missing — callers should treat failures as "no tags".
async function generateTags({ buffer, mimeType, filename }, config) {
  const cfg = config || (await loadAiConfig());
  if (!cfg) return [];
  if (cfg.provider === "odysseus") return tagWithOdysseus(buffer, mimeType, filename, cfg);
  return tagWithClaude(buffer, mimeType, cfg);
}

// Best-effort tagging for a stored attachment row; writes tags back to the DB. Returns the tags written.
async function tagStoredAttachment(attachment, config) {
  const filePath = path.join(UPLOAD_DIR, attachment.storagePath);
  if (!fs.existsSync(filePath)) return [];
  const buffer = fs.readFileSync(filePath);
  const tags = await generateTags({ buffer, mimeType: attachment.mimeType, filename: attachment.filename }, config);
  await prisma.attachment.update({ where: { id: attachment.id }, data: { tags: JSON.stringify(tags) } });
  return tags;
}

module.exports = { loadAiConfig, generateTags, tagStoredAttachment, parseTags };
