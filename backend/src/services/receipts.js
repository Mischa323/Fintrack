const { PrismaClient } = require("@prisma/client");
const { getConfig } = require("./ai");
const { generateJson, pick } = require("./ollama");

const prisma = new PrismaClient();

// Reads a photographed receipt, invoice or payslip with a local vision model and
// lines it up against transactions that are already recorded.
//
// Nothing is written without confirmation: extraction and matching only propose.
// A vision model misreads amounts often enough — a smudged 8 becomes a 3 — that
// silently creating money entries from a photo would be reckless.


// How far apart a receipt and its transaction may sit. A card payment usually
// books same-day, but a weekend or a pending charge pushes it out a few days.
const MATCH_WINDOW_DAYS = 5;
// Receipts and bank charges can differ by a rounding cent, or by a tip.
const AMOUNT_TOLERANCE = 0.02;

function buildPrompt(language, fromText) {
  const langHint = language
    ? `The document is most likely in ${language}, but may be in another language.`
    : "The document may be in any language.";
  return [
    fromText
      ? "You are reading the text of a financial document: a shop receipt, an invoice, or a payslip."
      : "You are reading a photo of a financial document: a shop receipt, an invoice, or a payslip.",
    langHint,
    "",
    "Extract exactly these fields:",
    "- merchant: the shop, company or employer name. Just the name, no address.",
    "- date: the document date as YYYY-MM-DD. Use the purchase/issue date.",
    "- amount: the TOTAL amount as a plain number, no currency symbol, dot as",
    "  decimal separator. For a receipt or invoice this is the final total paid,",
    "  after any discount — not a subtotal, a VAT line or a single item. For a",
    "  payslip use the net amount actually paid out (netto te ontvangen), not the",
    "  gross salary and not a cumulative year-to-date figure.",
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

// Turns whatever JSON the model produced into the fields a receipt needs.
// Names and formats vary per model and per run, so each is looked up under
// several keys and parsed leniently.
function toReceiptFields(parsed) {
  const merchant = pick(parsed, "merchant", "shop", "store", "company", "employer");
  const kind = String(pick(parsed, "kind", "type") || "").toUpperCase();
  const currency = pick(parsed, "currency", "valuta");
  const summary = pick(parsed, "summary", "description");

  return {
    merchant: merchant ? String(merchant).trim().slice(0, 200) : null,
    date: parseDate(pick(parsed, "date", "document_date", "purchase_date", "datum")),
    amount: parseAmount(pick(parsed, "amount", "total_amount", "total", "totaal", "grand_total")),
    currency: currency ? String(currency).trim().toUpperCase().slice(0, 3) : null,
    kind: ["RECEIPT", "INVOICE", "PAYSLIP"].includes(kind) ? kind : "UNKNOWN",
    summary: summary ? String(summary).trim().slice(0, 300) : null,
  };
}

async function extractFromImage(base64Image) {
  const config = await getConfig();
  if (!config.visionModel) {
    throw new Error(
      "No vision model is configured. Set one under Settings → Local AI to read photos; PDFs are read as text and work without one."
    );
  }
  const parsed = await generateJson({
    url: config.url,
    model: config.visionModel,
    prompt: buildPrompt(config.language, false),
    images: [base64Image],
    // Constraining the output empties the reply on some vision models
    constrain: false,
    // A thinking model reasons before answering and loses the answer if the
    // budget runs out, so the image path is given room.
    numPredict: 2500,
  });
  return toReceiptFields(parsed);
}

// A PDF invoice or payslip carries real text, so it is read directly instead of
// being rasterised and OCR'd — faster, more accurate, and it works with a
// text-only model.
async function extractFromPdf(buffer) {
  const { PDFParse } = require("pdf-parse");
  let text = "";
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    text = (result.text || "").trim();
  } catch (err) {
    throw new Error(`Could not read the PDF: ${err.message}`);
  } finally {
    try { await parser.destroy(); } catch {}
  }

  // A scanned PDF is just an image in a wrapper and yields nothing useful here.
  if (text.length < 40) {
    throw new Error(
      "This PDF holds no readable text — it is probably a scan. Upload a photo or screenshot of it instead, and use a vision model."
    );
  }

  const config = await getConfig();
  const parsed = await generateJson({
    url: config.url,
    model: config.model,
    prompt: [
      buildPrompt(config.language, true),
      "",
      "Document text:",
      // Trimmed: the tail of a long invoice is terms and conditions, and a large
      // prompt slows a local model down considerably.
      text.slice(0, 6000),
    ].join("\n"),
    numPredict: 900,
  });
  return toReceiptFields(parsed);
}

// Routes a file to the right reader based on what it actually is.
async function extractFromFile(buffer, mimeType) {
  if (mimeType === "application/pdf") return extractFromPdf(buffer);
  return extractFromImage(buffer.toString("base64"));
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

module.exports = { extractFromImage, extractFromPdf, extractFromFile, findMatches, MATCH_WINDOW_DAYS };
