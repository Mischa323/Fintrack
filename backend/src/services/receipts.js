const { PrismaClient } = require("@prisma/client");
const { getConfig } = require("./ai");

const prisma = new PrismaClient();

// Reads a photographed receipt, invoice or payslip with a local vision model and
// lines it up against transactions that are already recorded.
//
// Nothing is written without confirmation: extraction and matching only propose.
// A vision model misreads amounts often enough — a smudged 8 becomes a 3 — that
// silently creating money entries from a photo would be reckless.

const VISION_TIMEOUT_MS = 180000;

// How far apart a receipt and its transaction may sit. A card payment usually
// books same-day, but a weekend or a pending charge pushes it out a few days.
const MATCH_WINDOW_DAYS = 5;
// Receipts and bank charges can differ by a rounding cent, or by a tip.
const AMOUNT_TOLERANCE = 0.02;

function buildPrompt(language) {
  const langHint = language
    ? `The document is most likely in ${language}, but may be in another language.`
    : "The document may be in any language.";
  return [
    "You are reading a photo of a financial document: a shop receipt, an invoice,",
    "or a payslip.",
    langHint,
    "",
    "Extract exactly these fields:",
    "- merchant: the shop, company or employer name. Just the name, no address.",
    "- date: the document date as YYYY-MM-DD. Use the purchase/issue date.",
    "- amount: the TOTAL amount as a plain number, no currency symbol, dot as",
    "  decimal separator. For a receipt this is the total paid, not a subtotal or",
    "  a single line item. For a payslip use the net amount paid out.",
    "- currency: the three-letter code, e.g. EUR.",
    "- kind: one of RECEIPT, INVOICE, PAYSLIP.",
    "- summary: one short line describing what was bought or paid.",
    "",
    "Rules:",
    "- Read the values off the document; never invent one.",
    "- If a field is genuinely not visible or you are unsure, use null for it.",
    "- The total is usually the largest amount, often labelled TOTAAL, TOTAL,",
    "  SUMME, TE BETALEN, or BEDRAG.",
    "",
    'Answer with only: {"merchant":"...","date":"YYYY-MM-DD","amount":12.34,"currency":"EUR","kind":"RECEIPT","summary":"..."}',
  ].join("\n");
}

function parseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : null;
  // Models return "21,80", "€21.80" or "1.234,56" depending on the document
  let text = String(value).replace(/[^0-9.,-]/g, "");
  if (text.includes(",") && text.includes(".")) {
    // Whichever separator comes last is the decimal one
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  const n = parseFloat(text);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();

  // Documents are dated 12-07-2026 or 12/07/2026 as often as ISO, and
  // Date() reads that as a US month/day, so day-first is handled explicitly.
  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (dayFirst) {
    const [, d, m, y] = dayFirst;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) return null;
  // A hallucinated date is usually absurd
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return parsed;
}

// Field names drift between runs — amount comes back as total_amount or total —
// so each value is looked up under the names the model actually uses.
function pick(obj, ...names) {
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== "") return obj[name];
  }
  return null;
}

// The model is a thinking model: it emits reasoning before the answer, so the
// JSON has to be found inside free text rather than assumed to be the whole
// response.
function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Sends the image to the model and returns the fields it could read.
async function extractFromImage(base64Image) {
  const { url, model, language } = await getConfig();
  if (!model) throw new Error("No model configured — set one in Settings first");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  let data;
  try {
    const response = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: buildPrompt(language),
        images: [base64Image],
        stream: false,
        // No `format` here on purpose: constraining the output silently returns
        // an empty response from vision models like qwen3-vl. The JSON is asked
        // for in the prompt and picked out of the reply instead.
        think: false,
        // Thinking models spend this budget reasoning before answering, and the
        // answer is dropped if nothing is left, so it is deliberately generous.
        options: { temperature: 0, num_predict: 2500 },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // A text-only model rejects the images field, which is the most likely
      // failure here and deserves a comprehensible message.
      if (/does not support|image/i.test(body)) {
        throw new Error(
          `The model "${model}" cannot read images. Pick a vision model in Settings — for example qwen3-vl.`
        );
      }
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }
    data = await response.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The model took too long to read the image");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const parsed = extractJson(data.response) || extractJson(data.thinking);
  if (!parsed) {
    throw new Error(
      "The model did not return readable data for this image. A sharper or straighter photo usually helps."
    );
  }

  const merchant = pick(parsed, "merchant", "shop", "store", "company", "employer");
  const kind = String(pick(parsed, "kind", "type") || "").toUpperCase();

  return {
    merchant: merchant ? String(merchant).trim().slice(0, 200) : null,
    date: parseDate(pick(parsed, "date", "document_date", "purchase_date", "datum")),
    amount: parseAmount(pick(parsed, "amount", "total_amount", "total", "totaal", "grand_total")),
    currency: (() => {
      const c = pick(parsed, "currency", "valuta");
      return c ? String(c).trim().toUpperCase().slice(0, 3) : null;
    })(),
    kind: ["RECEIPT", "INVOICE", "PAYSLIP"].includes(kind) ? kind : "UNKNOWN",
    summary: (() => {
      const s = pick(parsed, "summary", "description");
      return s ? String(s).trim().slice(0, 300) : null;
    })(),
  };
}

function scoreMatch(receipt, transaction) {
  const amountDiff = Math.abs(Number(transaction.amount) - receipt.amount);
  const dayDiff = Math.abs(transaction.date - receipt.date) / 86400000;

  // Amount is the strong signal; the date narrows it; the name only breaks ties,
  // because a bank description rarely matches a receipt's header exactly.
  let score = 0;
  if (amountDiff <= AMOUNT_TOLERANCE) score += 60;
  else if (amountDiff <= 0.5) score += 40;
  else return 0; // a different amount is a different payment

  if (dayDiff <= 0.5) score += 30;
  else if (dayDiff <= 2) score += 20;
  else if (dayDiff <= MATCH_WINDOW_DAYS) score += 10;

  if (receipt.merchant) {
    const merchant = receipt.merchant.toLowerCase();
    const description = (transaction.description || "").toLowerCase();
    const word = merchant.split(/\s+/).find((w) => w.length >= 4);
    if (description.includes(merchant) || (word && description.includes(word))) score += 10;
  }
  return score;
}

// Finds transactions this receipt could belong to, best first. A payslip is
// income, a receipt or invoice is an expense, so only that side is searched.
async function findMatches(extracted, limit = 5) {
  if (extracted.amount == null || !extracted.date) return [];

  const from = new Date(extracted.date);
  from.setDate(from.getDate() - MATCH_WINDOW_DAYS);
  const to = new Date(extracted.date);
  to.setDate(to.getDate() + MATCH_WINDOW_DAYS);

  const type = extracted.kind === "PAYSLIP" ? "INCOME" : "EXPENSE";

  const candidates = await prisma.transaction.findMany({
    where: { type, date: { gte: from, lte: to } },
    include: { account: { select: { id: true, name: true } }, category: true },
    take: 500,
  });

  return candidates
    .map((t) => ({ transaction: t, score: scoreMatch(extracted, t) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => ({
      id: m.transaction.id,
      description: m.transaction.description,
      amount: Number(m.transaction.amount),
      date: m.transaction.date,
      type: m.transaction.type,
      account: m.transaction.account,
      category: m.transaction.category,
      score: m.score,
      // Only an amount-and-same-day hit is called confident; everything else is
      // offered as a candidate for the user to pick.
      confident: m.score >= 90,
    }));
}

module.exports = { extractFromImage, findMatches, MATCH_WINDOW_DAYS };
