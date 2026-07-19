const crypto = require("crypto");
const { XMLParser } = require("fast-xml-parser");

// Parser for ISO 20022 CAMT.053 bank statements (as exported by ABN AMRO and
// most other European banks). Produces the same row shape the CSV importers use,
// so it can feed straight into the shared transaction persistence path.

function textOf(node) {
  if (node === undefined || node === null) return null;
  if (typeof node === "object") return "#text" in node ? node["#text"] : null;
  return node;
}

function asArray(node) {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

function firstString(...values) {
  for (const value of values) {
    const text = textOf(value);
    if (text !== null && text !== undefined && String(text).trim() !== "") {
      return String(text).trim();
    }
  }
  return null;
}

// Banks emit placeholders where a reference is absent; they are not unique.
const PLACEHOLDER_REFS = new Set(["NOTPROVIDED", "NULL", "UNKNOWN", "NONREF", "NA", "-"]);

function usableRef(value) {
  if (!value) return false;
  return !PLACEHOLDER_REFS.has(String(value).trim().toUpperCase());
}

function parseEntry(ntry, fallbackCounter) {
  // camt.053 carries booked entries; skip anything still pending.
  const status = firstString(ntry?.Sts?.Cd, ntry?.Sts);
  if (status && status.toUpperCase() === "PDNG") return null;

  const amount = Math.abs(parseFloat(firstString(ntry?.Amt)));
  if (!Number.isFinite(amount)) return null;

  const indicator = (firstString(ntry?.CdtDbtInd) || "").toUpperCase();
  const type = indicator === "CRDT" ? "INCOME" : "EXPENSE";

  const dateStr = firstString(
    ntry?.BookgDt?.Dt, ntry?.BookgDt?.DtTm,
    ntry?.ValDt?.Dt, ntry?.ValDt?.DtTm
  );
  const date = dateStr ? new Date(dateStr) : null;
  if (!date || isNaN(date.getTime())) return null;

  const txDetails = asArray(ntry?.NtryDtls?.TxDtls);

  // Remittance information — the human-readable payment description
  const remittance = [];
  for (const tx of txDetails) {
    for (const line of asArray(tx?.RmtInf?.Ustrd)) {
      const text = firstString(line);
      if (text) remittance.push(text);
    }
    const structured = firstString(tx?.RmtInf?.Strd?.CdtrRefInf?.Ref);
    if (structured) remittance.push(structured);
  }

  // The counterparty is the creditor when money goes out, the debtor when it comes in
  let counterpartyName = null;
  let counterpartyIban = null;
  for (const tx of txDetails) {
    const parties = tx?.RltdPties;
    if (!parties) continue;
    if (type === "EXPENSE") {
      counterpartyName = counterpartyName || firstString(parties?.Cdtr?.Nm, parties?.Cdtr?.Pty?.Nm);
      counterpartyIban = counterpartyIban || firstString(parties?.CdtrAcct?.Id?.IBAN);
    } else {
      counterpartyName = counterpartyName || firstString(parties?.Dbtr?.Nm, parties?.Dbtr?.Pty?.Nm);
      counterpartyIban = counterpartyIban || firstString(parties?.DbtrAcct?.Id?.IBAN);
    }
  }

  const additional = firstString(ntry?.AddtlNtryInf);
  const description =
    remittance.join(" ").trim() || counterpartyName || additional || "Bank transaction";

  // Prefer the bank's own unique reference so re-imports deduplicate reliably
  let externalId = firstString(ntry?.AcctSvcrRef);
  if (!usableRef(externalId)) {
    externalId = null;
    for (const tx of txDetails) {
      const candidate = firstString(tx?.Refs?.AcctSvcrRef, tx?.Refs?.TxId, tx?.Refs?.EndToEndId);
      if (usableRef(candidate)) { externalId = candidate; break; }
    }
  }
  if (!usableRef(externalId)) externalId = firstString(ntry?.NtryRef);
  if (!usableRef(externalId)) externalId = null;

  if (!externalId) {
    // No bank reference: derive a stable id from the entry's own content so that
    // re-importing the same statement skips rather than duplicates. The counter
    // disambiguates genuinely identical entries within one file.
    const basis = [date.toISOString().slice(0, 10), amount.toFixed(2), type, description].join("|");
    const occurrence = (fallbackCounter.get(basis) || 0) + 1;
    fallbackCounter.set(basis, occurrence);
    const hash = crypto.createHash("sha1").update(`${basis}|${occurrence}`).digest("hex");
    externalId = `camt-${hash.slice(0, 24)}`;
  }

  const notes = [counterpartyName, counterpartyIban, additional !== description ? additional : null]
    .filter(Boolean)
    .join(" · ") || null;

  return {
    date,
    description: description.slice(0, 500),
    amount,
    type,
    categoryName: null,
    notes,
    externalId,
    counterpartyName,
    counterpartyIban,
  };
}

// Returns { iban, currency, entries: [...] }
function parseCamt053(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true, // tolerate ns-prefixed documents
    trimValues: true,
    parseTagValue: false, // keep IBANs/references as strings
  });

  let doc;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new Error(`File is not valid XML: ${err.message}`);
  }

  const root = doc?.Document?.BkToCstmrStmt;
  if (!root) {
    throw new Error("Not a CAMT.053 statement — expected Document/BkToCstmrStmt");
  }

  const statements = asArray(root.Stmt);
  if (statements.length === 0) throw new Error("No statements found in the file");

  const entries = [];
  const fallbackCounter = new Map();
  let iban = null;
  let currency = null;

  for (const stmt of statements) {
    iban = iban || firstString(stmt?.Acct?.Id?.IBAN, stmt?.Acct?.Id?.Othr?.Id);
    currency = currency || firstString(stmt?.Acct?.Ccy);
    for (const ntry of asArray(stmt.Ntry)) {
      const entry = parseEntry(ntry, fallbackCounter);
      if (entry) entries.push(entry);
    }
  }

  return { iban, currency, entries };
}

module.exports = { parseCamt053 };
