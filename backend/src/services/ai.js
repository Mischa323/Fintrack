const { PrismaClient } = require("@prisma/client");
const { generateJson, unwrap } = require("./ollama");

const prisma = new PrismaClient();

// Suggests a category and a readable merchant name for imported transactions,
// using an Ollama instance the user runs themselves. Nothing is sent anywhere
// else, and nothing is applied without confirmation — a small local model is
// good at tidying names but only roughly right about categories.

const DEFAULT_URL = "http://host.docker.internal:11434";
const BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 120000;

// Addresses get pasted with stray whitespace, a trailing slash, or https on a
// server that only speaks plain HTTP. Normalise rather than fail on it.
function normaliseUrl(value) {
  let url = String(value || "").trim().replace(/\s+/g, "");
  if (!url) return DEFAULT_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  // Ollama serves plain HTTP; https here is almost always a typo that would
  // otherwise fail with a confusing TLS error.
  url = url.replace(/^https:\/\//i, "http://");
  return url.replace(/\/+$/, "");
}

async function getConfig() {
  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return {
    url: normaliseUrl(settings.aiUrl),
    model: settings.aiModel || null,
    // Images need their own model; the text model stays authoritative for
    // everything else. Falls back to the text model only if none is set.
    visionModel: settings.aiVisionModel || null,
    language: (settings.aiLanguage || "").trim() || null,
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
    // Capabilities tell the UI which models can actually read an image
    const models = (data.models || []).map((m) => m.name);
    const visionModels = (data.models || [])
      .filter((m) => (m.capabilities || []).includes("vision"))
      .map((m) => m.name);
    return { ok: true, url, model, models, visionModels };
  } catch (err) {
    const reason = err.name === "AbortError" ? "timed out" : err.message;
    return {
      ok: false,
      url,
      model,
      models: [],
      visionModels: [],
      error: `Could not reach Ollama at ${url} (${reason}). From a container, localhost is the container itself — use host.docker.internal or the host's LAN address.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(rows, categories, language) {
  // A stated language biases the model toward it; without one it is told to
  // expect anything, since a single account often mixes languages (a Dutch
  // account with German and Austrian purchases, say).
  const intro = language
    ? `You are labelling bank transactions, mostly in ${language}. Some may be in other languages.`
    : "You are labelling bank transactions. They may be in any language — Dutch, English, German, French and others can appear in the same batch.";
  return [
    intro,
    "",
    "For each transaction return:",
    "- category: the ONE name from the Categories list that best fits. If none of them",
    '  clearly fits, return an empty string "". Never invent a name that is not in the list.',
    "- name: the merchant, cleaned up",
    "",
    "How to choose the category:",
    "- Judge what the merchant actually IS, then pick the closest name that exists in the list.",
    "- Do NOT default to a groceries or food category. Use it only for real supermarkets and",
    "  food shops — never for streaming, apps, games, subscriptions, web shops or transfers.",
    '- When in doubt, return "" for the category. A blank is better than a wrong guess.',
    "",
    "Cleaning rules for name:",
    "- Keep the merchant's own name in its own language; never translate it",
    "- Use Title Case, never ALL CAPS",
    "- Remove payment noise: BEA, Betaalpas, Apple Pay, PAS123, terminal codes, city names, times, dates",
    "- Remove payment providers like BUCKAROO, Mollie, Adyen, iDEAL, and any * prefix",
    "- Keep it to 1-4 words: the shop or company only",
    "",
    "What kind of thing each merchant is (then map it to the closest name in the list, else \"\"):",
    "- Supermarkets, food shops (Albert Heijn, Lidl, Jumbo, Aldi, Rewe, Edeka, Carrefour): groceries",
    "- Fuel, petrol, tanken, Tankstelle, Shell, BP, Esso, parking, public transport, NS, OV, transit: transport",
    "- Streaming, apps, games, digital subscriptions (Netflix, Spotify, YouTube, Disney, Crunchyroll,",
    "  Google Play, Google One, Apple, iCloud, Xbox, PlayStation, Patreon, Kavita): entertainment or subscriptions",
    "- Restaurants, cafes, bars, takeaway, Thuisbezorgd, Uber Eats, McDonald's, coffee: dining / eating out",
    "- Web shops and marketplaces (Amazon, bol.com, Coolblue, MediaMarkt, AliExpress, Zalando): shopping",
    "- Phone, internet, TV providers (Vodafone, KPN, Odido, T-Mobile, Ziggo): telecom or utilities",
    "- Energy and water (Eneco, Vattenfall, Essent, Greenchoice): utilities",
    "- Insurance (verzekering, Zorgverzekering, DFZ): insurance",
    "- Rent or mortgage (huur, hypotheek): housing",
    "- Bank fees, interest, card charges (kosten, rente, Zinsen): fees",
    "- Incoming salary or pay (salaris, loon, payroll): salary or income",
    "",
    "Examples:",
    '"BEA, Apple Pay ALBERT HEIJN 5678, PAS144" -> category groceries, name "Albert Heijn"',
    '"NETFLIX.COM BY ADYEN" -> category entertainment (or "" if no such category), name "Netflix"',
    '"YOUTUBEPREMIUM GOOGLE" -> category entertainment (or "" if no such category), name "YouTube"',
    '"CCV*BAKKER JANSEN AMSTERDAM" -> name "Bakker Jansen"',
    "",
    `Categories (use one of these exact names, or ""): ${categories.join(", ")}`,
    "",
    "Transactions:",
    ...rows.map((r) => `${r.i}. "${r.description}" ${r.amount} EUR ${r.type}`),
    "",
    'Return every one, and leave category "" when unsure:',
    '{"results":[{"i":1,"category":"groceries","name":"Albert Heijn"},{"i":2,"category":"","name":"Revolut"}]}',
  ].join("\n");
}

// Maps the model's category word onto one that actually exists, rather than
// rejecting anything that is not spelled identically. A weak model returns
// generic words ("transport", "salary", "dining") that rarely match a user's
// exact names ("Transportation", "Income"), so: try an exact match, then a
// substring either way, then a small synonym table. No match returns null and the
// suggestion is reported as unknown, so nothing is mis-filed silently.
const CATEGORY_SYNONYMS = {
  salary: "income", wage: "income", wages: "income", payroll: "income", loon: "income", salaris: "income",
  fuel: "transport", petrol: "transport", gas: "transport", transit: "transport", travel: "transport",
  dining: "restaurant", restaurants: "restaurant", takeaway: "restaurant", food: "grocer",
  streaming: "entertainment", media: "entertainment",
  subscription: "subscription", telecom: "utilit", phone: "utilit", internet: "utilit", energy: "utilit",
  rent: "housing", mortgage: "housing", shopping: "shop", webshop: "shop",
};

function resolveCategory(raw, categories) {
  const name = String(raw || "").trim().toLowerCase();
  if (!name) return null;
  const norm = categories.map((c) => ({ c, n: c.name.trim().toLowerCase() }));

  // Exact
  const exact = norm.find((x) => x.n === name);
  if (exact) return exact.c;

  // Substring either direction, but only for words long enough to be meaningful
  // (avoids "in" matching "Income"/"Insurance"). Handles transport↔transportation.
  if (name.length >= 4) {
    const sub = norm.find((x) => x.n.includes(name) || (x.n.length >= 4 && name.includes(x.n)));
    if (sub) return sub.c;
  }

  // Synonym → concept, then match that concept against the real categories
  const concept = CATEGORY_SYNONYMS[name];
  if (concept) {
    const syn = norm.find((x) => x.n.includes(concept) || concept.includes(x.n));
    if (syn) return syn.c;
  }
  return null;
}

// Returns one suggestion per transaction that the model answered for. Anything
// it skipped or answered nonsensically is simply left out rather than guessed.
async function suggestForTransactions(transactionIds) {
  const { url, model, language } = await getConfig();
  if (!model) throw new Error("No model configured — set one in Settings first");

  const transactions = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, description: true, amount: true, type: true, categoryId: true },
  });
  if (transactions.length === 0) return { suggestions: [], failed: 0 };

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const names = categories.map((c) => c.name);

  const suggestions = [];
  let failed = 0;
  let failureReason = null;

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
      answers = unwrap(
        await generateJson({ url, model, prompt: buildPrompt(rows, names, language), numPredict: 2000 }),
        "results"
      );
    } catch (err) {
      // Keep the reason rather than counting a silent failure: with the wrong
      // kind of model every batch fails identically, and the user needs to be
      // told that instead of seeing "0 suggestions".
      failed += batch.length;
      if (!failureReason) failureReason = err.message;
      continue;
    }

    for (const answer of answers) {
      const target = batch[Number(answer.i) - 1];
      if (!target) continue;
      const category = resolveCategory(answer.category, categories);
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

  return { suggestions, failed, model, failureReason };
}

// Proposes which categories cover the same ground and could be folded together.
// Imports create a category per name encountered, so lists drift into things like
// "Renault Megane" and "Simkaart" sitting beside "Transportation".
async function suggestCategoryMerges() {
  const { url, model } = await getConfig();
  if (!model) throw new Error("No model configured — set one in Settings first");

  const categories = await prisma.category.findMany({
    select: {
      id: true, name: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { name: "asc" },
  });
  if (categories.length < 2) return { groups: [] };

  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

  // Phrased as "find the specific ones" rather than "merge if you think you
  // should" — offered the easy way out, a small model returns an empty list
  // every time.
  const prompt = [
    "A personal finance app built this category list automatically while importing",
    "bank data, so some entries are one specific thing (a car model, a phone plan, a",
    "shop) that really belongs under a broader category already in the list.",
    "",
    "Go through the list and find those. For each one, say which broader category in",
    "the list it should live under.",
    "",
    "Rules:",
    "- Both names must be copied exactly from the list",
    "- Keep the broader, reusable one; merge away the specific one",
    "- A brand or product name is almost always the specific one",
    "- Leave a category alone if no broader match exists in the list",
    "",
    "The list:",
    ...categories.map((c) => `- ${c.name}`),
    "",
    "Example of the reasoning: a category named after one supermarket belongs under a",
    "general groceries or food category; a category named after one insurance policy",
    "belongs under Insurance.",
    "",
    'Answer: {"groups":[{"keep":"<broad name from list>","merge":["<specific name from list>"],"why":"<short reason>"}]}',
  ].join("\n");

  const raw = unwrap(await generateJson({ url, model, prompt, numPredict: 1500 }), "groups");

  const groups = [];
  const used = new Set();
  for (const group of raw) {
    const target = byName.get(String(group.keep || "").trim().toLowerCase());
    if (!target || used.has(target.id)) continue;

    // Only names that actually exist, never the target itself, never reused
    const sources = (Array.isArray(group.merge) ? group.merge : [])
      .map((n) => byName.get(String(n || "").trim().toLowerCase()))
      .filter((c) => c && c.id !== target.id && !used.has(c.id));
    if (sources.length === 0) continue;

    used.add(target.id);
    for (const s of sources) used.add(s.id);
    groups.push({
      targetId: target.id,
      targetName: target.name,
      sources: sources.map((c) => ({ id: c.id, name: c.name, count: c._count.transactions })),
      why: String(group.why || "").slice(0, 200) || null,
      movedTransactions: sources.reduce((n, c) => n + c._count.transactions, 0),
    });
  }

  return { groups, model };
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

module.exports = {
  checkConnection,
  suggestForTransactions,
  applySuggestions,
  suggestCategoryMerges,
  getConfig,
};
