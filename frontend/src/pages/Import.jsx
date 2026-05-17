import { useState, useEffect, useRef } from "react";
import { importApi, accounts as accountsApi } from "../api/client";
import GlassCard from "../components/GlassCard";

export default function Import() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [mode, setMode] = useState("maybe");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  useEffect(() => { accountsApi.list().then((a) => { setAccounts(a); if (a[0]) setAccountId(a[0].id); }); }, []);

  const handleImport = async () => {
    if (!file || !accountId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = mode === "maybe" ? await importApi.maybe(accountId, file) : await importApi.generic(accountId, file);
      setResult(res);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 680 }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Import Data</h1>
        <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>Import from Maybe Finance or generic bank CSV</p>
      </div>

      {/* Format info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[
          {
            id: "maybe",
            title: "Maybe Finance",
            icon: "◈",
            desc: "Import from a Maybe Finance CSV export. Supports automatic category mapping, deduplication, and external IDs.",
            fields: "date, name, amount, currency, category, account, notes, id",
          },
          {
            id: "generic",
            title: "Generic Bank CSV",
            icon: "🏦",
            desc: "Import from a generic bank export. Auto-detects common column names in English and Dutch.",
            fields: "date/datum, amount/bedrag, description/omschrijving, category/categorie",
          },
        ].map((m) => (
          <GlassCard
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{ cursor: "pointer", borderColor: mode === m.id ? "rgba(99,102,241,0.6)" : undefined, background: mode === m.id ? "rgba(99,102,241,0.1)" : undefined }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{m.icon}</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.title}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>{m.desc}</div>
            <div style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", padding: "6px 10px", borderRadius: 8, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
              {m.fields}
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Target Account</div>
            <select className="glass-input" style={{ padding: "10px 14px", width: "100%" }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>CSV File</div>
            <div
              onClick={() => fileRef.current.click()}
              style={{
                border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 14, padding: "32px 20px",
                textAlign: "center", cursor: "pointer", transition: "border-color 0.2s",
              }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            >
              {file ? (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                  <div style={{ fontWeight: 500 }}>{file.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{(file.size / 1024).toFixed(1)} KB</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>⇪</div>
                  <div style={{ fontWeight: 500 }}>Drop your CSV here</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>or click to browse</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => setFile(e.target.files[0])} />
          </div>

          <button
            className="glass-btn glass-btn-primary"
            style={{ padding: "12px 24px", opacity: (!file || !accountId || loading) ? 0.5 : 1 }}
            onClick={handleImport}
            disabled={!file || !accountId || loading}
          >
            {loading ? "Importing…" : `Import from ${mode === "maybe" ? "Maybe Finance" : "Generic CSV"}`}
          </button>
        </div>
      </GlassCard>

      {result && (
        <GlassCard style={{ background: "rgba(52,211,153,0.1)", borderColor: "rgba(52,211,153,0.3)" }}>
          <div style={{ fontWeight: 600, color: "#34d399", fontSize: 16, marginBottom: 8 }}>Import complete</div>
          <div style={{ fontSize: 14 }}>
            <div>✓ <strong>{result.imported}</strong> transactions imported</div>
            {result.skipped > 0 && <div style={{ color: "rgba(255,255,255,0.5)", marginTop: 4 }}>↷ {result.skipped} rows skipped (duplicates or invalid)</div>}
            {result.errors?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {error && (
        <GlassCard style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)" }}>
          <div style={{ color: "#f87171", fontWeight: 600 }}>Import failed</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{error}</div>
        </GlassCard>
      )}

      {/* Maybe export guide */}
      <GlassCard style={{ padding: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>How to export from Maybe Finance</div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.8 }}>
          <li>Open your Maybe Finance account at app.maybe.co</li>
          <li>Go to <strong style={{ color: "rgba(255,255,255,0.8)" }}>Settings → Export</strong></li>
          <li>Choose <strong style={{ color: "rgba(255,255,255,0.8)" }}>Transactions CSV</strong></li>
          <li>Select the account and date range</li>
          <li>Upload the downloaded CSV file above</li>
        </ol>
      </GlassCard>
    </div>
  );
}
