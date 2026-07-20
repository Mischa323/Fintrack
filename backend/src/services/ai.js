const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Suggests a category and a readable merchant name for imported transactions,
// using an Ollama instance the user runs themselves. Nothing is sent anywhere
// else, and nothing is applied without confirmation — a small local model is
// good at tidying names but only roughly right about categories.

const DEFAULT_URL = "http://host.docker.internal:11434";
const BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 120000;

async function getConfig() {
  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return {
    url: (settings.aiUrl || DEFAULT_URL).replace(/\/+$/, ""),
    model: settings.aiModel || null,
  };
}

// Lists the models the configured Ollama has, which doubles as a reachability
// check — the usual failure is the container not being able to see the host.
async function checkConnection() {
  const { url, model } = await getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${url}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = (data.models || []).map((m) => m.name);
    return { ok: true, url, model, models };
  } catch (err) {
    const reason = err.name === "AbortError" ? "timed out" : err.message;
    return {
      ok: false,
      url,
      model,
      models: [],
      error: `Could not reach Ollama at ${url} (${reason}). From a container, localhost is the container itself — use host.docker.internal or the host's LAN address.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(rows, categories) {
  return [
    "You are labelling Dutch bank transactions.",
    "",
    "For each transaction return:",
    "- category: exactly one from the list below, nothing else",
    "- name: the merchant, cleaned up",
    "",
    "Cleaning rules for name:",
    "- Use Title Case, never ALL CAPS",
    "- Remove payment noise: BEA, Betaalpas, Apple Pay, PAS123, terminal codes, times, dates",
    "- Remove payment providers like BUCKAROO, Mollie, Adyen, iDEAL, and any * prefix",
    "- Keep it to 1-4 words: the shop or company only",
    "",
    "Category hints:",
    "- Fuel, petrol, tanken, Esso, Shell, BP, parking, public transport -> Transportation",
    "- Supermarkets (Albert Heijn, Lidl, Jumbo, Deka, Aldi) -> Groceries",
    "- Bank fees, interest, renteafsluiting -> whichever list entry covers fees",
    "",
    "Examples:",
    '"BEA, Apple Pay ALBERT HEIJN 5678, PAS144" -> "Albert Heijn"',
    '"CCV*BAKKER JANSEN AMSTERDAM" -> "Bakker Jansen"',
    '"NETFLIX.COM BY ADYEN" -> "Netflix"',
    "",
    `Categories: ${categories.join(", ")}`,
    "",
    "Transactions:",
    ...rows.map((r) => `${r.i}. "${r.description}" ${r.amount} EUR ${r.type}`),
    "",
    'Return every one: {"results":[{"i":1,"category":"Groceries","name":"Albert Heijn"}]}',
  ].join("\n");
}

async function askModel(url, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 2000 },
      }),
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const data = await response.json();
    // Asking for a wrapped array is what makes small models return every row
    // instead of stopping after the first object.
    const parsed = JSON.parse(data.response);
    return Array.isArray(parsed) ? parsed : parsed.results || [];
  } finally {
    clearTimeout(timer);
  }
}

// Returns one suggestion per transaction that the model answered for. Anything
// it skipped or answered nonsensically is simply left out rather than guessed.
async function suggestForTransactions(transactionIds) {
  const { url, model } = await getConfig();
  if (!model) throw new Error("No model configured — set one in Settings first");

  const transactions = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, description: true, amount: true, type: true, categoryId: true },
  });
  if (transactions.length === 0) return { suggestions: [], failed: 0 };

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const names = categories.map((c) => c.name);
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

  const suggestions = [];
  let failed = 0;

  for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
    const batch = transactions.slice(start, start + BATCH_SIZE);
    const rows = batch.map((t, index) => ({
      i: index + 1,
      description: t.description,
      amount: Number(t.amount),
      type: t.type,
    }));

    let answers;
    try {
      answers = await askModel(url, model, buildPrompt(rows, names));
    } catch {
      failed += batch.length;
      continue;
    }

    for (const answer of answers) {
      const target = batch[Number(answer.i) - 1];
      if (!target) continue;
      const category = byName.get(String(answer.category || "").trim().toLowerCase());
      const cleaned = String(answer.name || "").trim();
      // Only offer a change when there is actually something to change
      if (!category && !cleaned) continue;
      suggestions.push({
        id: target.id,
        current: { description: target.description, categoryId: target.categoryId },
        categoryId: category?.id || null,
        categoryName: category?.name || null,
        // Unknown category names are reported so the mismatch is visible
        rejectedCategory: !category && answer.category ? String(answer.category) : null,
        description: cleaned || target.description,
      });
    }
    failed += batch.length - answers.filter((a) => batch[Number(a.i) - 1]).length;
  }

  return { suggestions, failed, model };
}

// Applies only what was handed back, so the review step stays authoritative.
async function applySuggestions(changes) {
  let updated = 0;
  for (const change of changes) {
    const data = {};
    if (change.description) data.description = String(change.description).slice(0, 500);
    if (change.categoryId) data.categoryId = change.categoryId;
    if (Object.keys(data).length === 0) continue;
    try {
      await prisma.transaction.update({ where: { id: change.id }, data });
      updated++;
    } catch {
      // A transaction deleted between review and apply should not fail the rest
    }
  }
  return { updated };
}

module.exports = { checkConnection, suggestForTransactions, applySuggestions, getConfig };
