// People and banks write IBANs differently: "NL69 ABNA 0624 4857 06" from a
// banking site, "NL69ABNA0624485706" inside a CAMT file. Normalise before
// storing or comparing so the two forms match.
function normaliseIban(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/[\s-]+/g, "").toUpperCase();
  return cleaned || null;
}

module.exports = { normaliseIban };
