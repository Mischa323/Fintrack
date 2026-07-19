const { PrismaClient } = require("@prisma/client");
const { normaliseIban: sharedNormalise } = require("./iban");

const prisma = new PrismaClient();

// Detects transfers between two accounts that both exist in FinTrack.
//
// A transfer shows up twice in bank data: as money out of account A and money
// into account B. FinTrack models it as ONE row (accountId -> toAccountId), so
// the second leg must never become its own transaction.
//
// Modes:
//   off     — import everything as INCOME/EXPENSE (no detection)
//   auto    — link matching entries into TRANSFER rows during import
//   confirm — import normally, then surface candidate pairs for the user

const MODES = ["off", "auto", "confirm"];

// How far apart the two legs of one transfer may be booked.
const MATCH_WINDOW_DAYS = 4;

// Single shared implementation, so account IBANs and statement IBANs are always
// compared the same way (spaces and dashes stripped, uppercased).
const normaliseIban = sharedNormalise;

function daysBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

async function getDefaultMode() {
  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return MODES.includes(settings.transferDetection) ? settings.transferDetection : "confirm";
}

// Map of IBAN -> account, for every account that has one configured.
async function ibanAccountMap() {
  const accounts = await prisma.account.findMany({
    where: { iban: { not: null } },
    select: { id: true, name: true, iban: true },
  });
  const map = new Map();
  for (const a of accounts) {
    const key = normaliseIban(a.iban);
    if (key) map.set(key, a);
  }
  return map;
}

// Is this leg already represented by a transfer row we stored earlier?
// Covers importing the two statements of one transfer in either order.
async function mirrorLegExists({ accountId, otherAccountId, amount, date }) {
  const from = new Date(date);
  from.setDate(from.getDate() - MATCH_WINDOW_DAYS);
  const to = new Date(date);
  to.setDate(to.getDate() + MATCH_WINDOW_DAYS);

  const existing = await prisma.transaction.findFirst({
    where: {
      type: "TRANSFER",
      amount,
      date: { gte: from, lte: to },
      OR: [
        { accountId, toAccountId: otherAccountId },
        { accountId: otherAccountId, toAccountId: accountId },
      ],
    },
    select: { id: true },
  });
  return !!existing;
}

// Rewrites parsed rows in place for "auto" mode. Returns how many became
// transfers and how many were dropped as an already-recorded mirror leg.
async function applyAutoTransfers(rows, accountId) {
  const byIban = await ibanAccountMap();
  if (byIban.size === 0) return { rows, linked: 0, mirrorsSkipped: 0 };

  const result = [];
  let linked = 0;
  let mirrorsSkipped = 0;

  // Track transfers created within this same file so the opposite leg inside
  // one statement does not produce a second row.
  const pendingInFile = [];

  for (const row of rows) {
    const counterparty = byIban.get(normaliseIban(row.counterpartyIban));
    if (!counterparty || counterparty.id === accountId) {
      result.push(row);
      continue;
    }

    const alreadyInFile = pendingInFile.some(
      (p) =>
        p.otherAccountId === counterparty.id &&
        Math.abs(p.amount - row.amount) < 0.005 &&
        daysBetween(p.date, row.date) <= MATCH_WINDOW_DAYS
    );
    const alreadyStored = await mirrorLegExists({
      accountId,
      otherAccountId: counterparty.id,
      amount: row.amount,
      date: row.date,
    });

    if (alreadyInFile || alreadyStored) {
      mirrorsSkipped++;
      continue;
    }

    // Record the transfer in its natural direction: out of the paying account.
    const outgoing = row.type === "EXPENSE";
    result.push({
      ...row,
      type: "TRANSFER",
      transferFromAccountId: outgoing ? accountId : counterparty.id,
      transferToAccountId: outgoing ? counterparty.id : accountId,
    });
    pendingInFile.push({ otherAccountId: counterparty.id, amount: row.amount, date: row.date });
    linked++;
  }

  return { rows: result, linked, mirrorsSkipped };
}

const IBAN_PATTERN = /\b([A-Z]{2}\d{2}[A-Z0-9]{8,26})\b/;

// Transactions imported before counterpartyIban existed still carry the IBAN in
// their notes. Recover it so those rows can take part in transfer detection.
// Only touches rows where the column is still empty, so it is a no-op once done.
async function backfillCounterpartyIbans() {
  const rows = await prisma.transaction.findMany({
    where: { counterpartyIban: null, notes: { not: null }, importedFrom: { not: null } },
    select: { id: true, notes: true, account: { select: { iban: true } } },
    take: 5000,
  });

  let filled = 0;
  for (const row of rows) {
    const match = IBAN_PATTERN.exec(String(row.notes).replace(/\s+/g, ""));
    if (!match) continue;
    const iban = normaliseIban(match[1]);
    // Never store the account's own IBAN as its counterparty
    if (!iban || iban === normaliseIban(row.account?.iban)) continue;
    await prisma.transaction.update({ where: { id: row.id }, data: { counterpartyIban: iban } });
    filled++;
  }
  return filled;
}

// Counterparty IBANs that appear in the data but match no account. These are the
// ones the user probably still needs to fill in on an account for transfer
// detection to work.
async function unlinkedCounterpartyIbans(limit = 20) {
  const byIban = await ibanAccountMap();
  const rows = await prisma.transaction.findMany({
    where: { counterpartyIban: { not: null } },
    select: { counterpartyIban: true, notes: true, description: true },
    take: 5000,
    orderBy: { date: "desc" },
  });

  const seen = new Map();
  for (const row of rows) {
    const iban = normaliseIban(row.counterpartyIban);
    if (!iban || byIban.has(iban)) continue;
    const entry = seen.get(iban) || { iban, count: 0, name: null };
    entry.count++;
    if (!entry.name) entry.name = (row.notes || row.description || "").split(" · ")[0] || null;
    seen.set(iban, entry);
  }

  return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

// Finds INCOME/EXPENSE pairs that look like two legs of one transfer, for
// "confirm" mode. Returns newest first.
async function findTransferCandidates(limit = 50) {
  // Make older imports eligible before looking for pairs
  await backfillCounterpartyIbans();

  const byIban = await ibanAccountMap();
  if (byIban.size === 0) return [];

  const rows = await prisma.transaction.findMany({
    where: {
      type: { in: ["INCOME", "EXPENSE"] },
      counterpartyIban: { not: null },
    },
    select: {
      id: true, accountId: true, amount: true, date: true, type: true,
      description: true, counterpartyIban: true,
    },
    orderBy: { date: "desc" },
    take: 2000,
  });

  const accounts = await prisma.account.findMany({ select: { id: true, name: true } });
  const accountName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const candidates = [];
  const used = new Set();

  for (const row of rows) {
    if (used.has(row.id)) continue;
    const counterparty = byIban.get(normaliseIban(row.counterpartyIban));
    if (!counterparty || counterparty.id === row.accountId) continue;

    // The opposite leg: booked on the counterparty account, opposite direction,
    // same amount, close in time.
    const match = rows.find(
      (other) =>
        !used.has(other.id) &&
        other.id !== row.id &&
        other.accountId === counterparty.id &&
        other.type !== row.type &&
        Math.abs(Number(other.amount) - Number(row.amount)) < 0.005 &&
        daysBetween(other.date, row.date) <= MATCH_WINDOW_DAYS
    );
    if (!match) continue;

    used.add(row.id);
    used.add(match.id);

    const outgoing = row.type === "EXPENSE" ? row : match;
    const incoming = row.type === "EXPENSE" ? match : row;

    candidates.push({
      amount: Number(outgoing.amount),
      date: outgoing.date,
      from: { id: outgoing.accountId, name: accountName[outgoing.accountId] },
      to: { id: incoming.accountId, name: accountName[incoming.accountId] },
      outgoingId: outgoing.id,
      incomingId: incoming.id,
      description: outgoing.description,
    });
    if (candidates.length >= limit) break;
  }

  return candidates;
}

// Collapses a detected pair into a single TRANSFER row.
async function mergeCandidate(outgoingId, incomingId) {
  const [outgoing, incoming] = await Promise.all([
    prisma.transaction.findUnique({ where: { id: outgoingId } }),
    prisma.transaction.findUnique({ where: { id: incomingId } }),
  ]);
  if (!outgoing || !incoming) throw new Error("One of the transactions no longer exists");
  if (outgoing.accountId === incoming.accountId) throw new Error("Both legs are on the same account");

  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: outgoing.id },
      data: { type: "TRANSFER", toAccountId: incoming.accountId },
    }),
    prisma.transaction.delete({ where: { id: incoming.id } }),
  ]);

  return { id: outgoing.id };
}

module.exports = {
  MODES,
  backfillCounterpartyIbans,
  unlinkedCounterpartyIbans,
  getDefaultMode,
  applyAutoTransfers,
  findTransferCandidates,
  mergeCandidate,
};
