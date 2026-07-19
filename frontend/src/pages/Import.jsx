import { useState, useEffect, useRef } from "react";
import { importApi, backup as backupApi, accounts as accountsApi, config as configApi } from "../api/client";
import GlassCard from "../components/GlassCard";

const STEPS_MAYBE = ["Source", "Accounts", "Transactions"];
const STEPS_FINTRACK = ["Source", "Restore"];
const STEPS_ABN = ["Source", "Statement"];

function StepIndicator({ steps, current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 32 }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700,
                background: done ? "#34d399" : active ? "#818cf8" : "rgba(255,255,255,0.08)",
                color: done || active ? "#0f172a" : "rgba(255,255,255,0.35)",
                border: active ? "2px solid #818cf8" : "none",
                transition: "all 0.2s",
              }}>
                {done ? "✓" : i + 1}
              </div>
              <div style={{ fontSize: 11, color: active ? "#c7d2fe" : done ? "#6ee7b7" : "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "#34d399" : "rgba(255,255,255,0.08)", marginBottom: 18, transition: "background 0.3s" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileDropzone({ fileRef, file, onFile, accept = ".csv", label = "Drop your file here" }) {
  return (
    <div>
      <div
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        style={{
          border: `2px dashed ${file ? "rgba(129,140,248,0.5)" : "rgba(255,255,255,0.15)"}`,
          borderRadius: 14, padding: "28px 20px", textAlign: "center", cursor: "pointer",
          background: file ? "rgba(99,102,241,0.07)" : undefined,
          transition: "all 0.2s",
        }}
      >
        {file ? (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{(file.size / 1024).toFixed(1)} KB — click to change</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>⇪</div>
            <div style={{ fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>or click to browse</div>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept={accept} style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
    </div>
  );
}

// Multi-file variant: ABN AMRO exports one file per day, so statements arrive
// in batches of dozens.
function MultiFileDropzone({ fileRef, files, onFiles, accept = ".xml", label = "Drop your files here" }) {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return (
    <div>
      <div
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); }}
        style={{
          border: `2px dashed ${files.length ? "rgba(129,140,248,0.5)" : "rgba(255,255,255,0.15)"}`,
          borderRadius: 14, padding: "24px 20px", textAlign: "center", cursor: "pointer",
          background: files.length ? "rgba(99,102,241,0.07)" : undefined,
          transition: "all 0.2s",
        }}
      >
        {files.length ? (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🗂</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {files.length} file{files.length !== 1 ? "s" : ""} selected
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
              {(total / 1024).toFixed(0)} KB total — click to change
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>⇪</div>
            <div style={{ fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              or click to browse — you can select many at once
            </div>
          </div>
        )}
      </div>
      <input
        ref={fileRef} type="file" accept={accept} multiple style={{ display: "none" }}
        onChange={(e) => onFiles([...e.target.files])}
      />
    </div>
  );
}

function ResultBanner({ result, onDismiss }) {
  if (!result) return null;
  const isError = result.error;
  return (
    <div style={{
      borderRadius: 12, padding: "14px 18px", fontSize: 14,
      background: isError ? "rgba(239,68,68,0.12)" : "rgba(52,211,153,0.12)",
      border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(52,211,153,0.3)"}`,
      display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
    }}>
      <div style={{ color: isError ? "#f87171" : "#34d399" }}>{result.message}</div>
      {onDismiss && <button onClick={onDismiss} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 0, fontSize: 16 }}>×</button>}
    </div>
  );
}

// ── Step 1: choose source ────────────────────────────────────────────────────
function StepSource({ onChoose }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState(null);
  const [showClear, setShowClear] = useState(false);

  useEffect(() => {
    accountsApi.list().then((a) => { setAccounts(a); if (a[0]) setAccountId(a[0].id); });
  }, []);

  const handleClear = async () => {
    if (!accountId) return;
    if (!window.confirm("Delete all imported transactions for this account?")) return;
    setClearing(true);
    setClearResult(null);
    try {
      const res = await importApi.clear(accountId, "maybe");
      setClearResult(`✓ ${res.deleted} imported transactions removed`);
    } catch (e) {
      setClearResult("Error: " + (e.response?.data?.error || e.message));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 15, color: "rgba(255,255,255,0.55)" }}>Choose where you want to import data from.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[
          {
            id: "maybe",
            icon: "◈",
            title: "Maybe Finance",
            desc: "Import from a Maybe Finance export ZIP. Brings in your accounts, balances and full transaction history.",
            badge: "CSV",
          },
          {
            id: "abn",
            icon: "🏦",
            title: "ABN AMRO",
            desc: "Import a CAMT.053 statement downloaded from ABN AMRO internet banking. Keeps counterparty details and skips duplicates.",
            badge: "CAMT.053",
          },
          {
            id: "fintrack",
            icon: "🗄",
            title: "FinTrack Backup",
            desc: "Restore a full database backup made by FinTrack. Replaces all current data with the backup.",
            badge: ".db",
            warn: true,
          },
        ].map((s) => (
          <GlassCard
            key={s.id}
            onClick={() => onChoose(s.id)}
            style={{ cursor: "pointer", transition: "border-color 0.15s" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ fontSize: 28 }}>{s.icon}</div>
              <span style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600,
                background: s.warn ? "rgba(248,113,113,0.15)" : "rgba(99,102,241,0.2)",
                color: s.warn ? "#f87171" : "#818cf8",
              }}>{s.badge}</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{s.title}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{s.desc}</div>
          </GlassCard>
        ))}
      </div>

      {/* Clear imported data */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
        <button
          onClick={() => { setShowClear((v) => !v); setClearResult(null); }}
          style={{ background: "none", border: "none", color: "rgba(248,113,113,0.7)", fontSize: 13, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ fontSize: 16 }}>⚠</span> Clear imported data {showClear ? "▲" : "▼"}
        </button>
        {showClear && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
              Deletes all imported transactions for the selected account. Does not affect manually entered transactions.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <select
                className="glass-input"
                style={{ flex: 1, padding: "9px 12px" }}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button
                className="glass-btn"
                style={{ padding: "9px 16px", color: "#f87171", borderColor: "rgba(248,113,113,0.3)", opacity: (!accountId || clearing) ? 0.5 : 1 }}
                onClick={handleClear}
                disabled={!accountId || clearing}
              >
                {clearing ? "Clearing…" : "Clear Import"}
              </button>
            </div>
            {clearResult && (
              <div style={{ fontSize: 13, color: clearResult.startsWith("Error") ? "#f87171" : "#34d399" }}>{clearResult}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Maybe step 2: accounts.csv ───────────────────────────────────────────────
function StepMaybeAccounts({ onDone, onBack }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  const handle = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await importApi.maybeAccounts(file);
      const names = res.accounts.map((a) => `${a.name} (€${Number(a.balance).toFixed(2)})`).join(", ");
      setResult({ message: `✓ ${res.accounts.length} account${res.accounts.length !== 1 ? "s" : ""} synced: ${names}` });
    } catch (e) {
      setResult({ error: true, message: e.response?.data?.error || e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Import accounts.csv</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          Upload the <code>accounts.csv</code> from your Maybe Finance export ZIP. This creates your accounts in FinTrack and sets their correct current balances.
        </div>
      </div>

      <FileDropzone fileRef={fileRef} file={file} onFile={setFile} label="Drop accounts.csv here" />
      <ResultBanner result={result} onDismiss={() => setResult(null)} />

      <div style={{ display: "flex", gap: 10 }}>
        <button className="glass-btn" style={{ padding: "11px 20px" }} onClick={onBack}>← Back</button>
        <button
          className="glass-btn glass-btn-primary"
          style={{ flex: 1, padding: "11px 20px", opacity: (!file || loading) ? 0.5 : 1 }}
          onClick={handle}
          disabled={!file || loading}
        >
          {loading ? "Importing…" : "Import Accounts"}
        </button>
        <button
          className="glass-btn"
          style={{ padding: "11px 20px", opacity: !result || result.error ? 0.5 : 1 }}
          onClick={onDone}
          disabled={!result || result.error}
        >
          Next →
        </button>
      </div>
      {!result && (
        <button onClick={onDone} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 13, cursor: "pointer", padding: 0, textAlign: "left" }}>
          Skip this step (accounts already set up)
        </button>
      )}
    </div>
  );
}

// ── Maybe step 3: transactions.csv ───────────────────────────────────────────
function StepMaybeTransactions({ onBack }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    accountsApi.list().then((a) => { setAccounts(a); if (a[0]) setAccountId(a[0].id); });
  }, []);

  const handleImport = async () => {
    if (!file || !accountId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await importApi.maybe(accountId, file);
      setResult({ message: `✓ ${res.imported} transactions imported${res.skipped ? `, ${res.skipped} skipped` : ""}` });
    } catch (e) {
      setResult({ error: true, message: e.response?.data?.error || e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!accountId) return;
    if (!window.confirm("Delete all Maybe Finance imported transactions for this account?")) return;
    setClearing(true);
    setResult(null);
    try {
      const res = await importApi.clear(accountId, "maybe");
      setResult({ message: `✓ ${res.deleted} imported transactions cleared from this account` });
    } catch (e) {
      setResult({ error: true, message: e.response?.data?.error || e.message });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Import transactions.csv</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          Upload the <code>transactions.csv</code> from your Maybe Finance export ZIP. Select which account to assign the transactions to.
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Target Account</div>
        <select className="glass-input" style={{ padding: "10px 14px", width: "100%" }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <FileDropzone fileRef={fileRef} file={file} onFile={setFile} label="Drop transactions.csv here" />
      <ResultBanner result={result} onDismiss={() => setResult(null)} />

      <div style={{ display: "flex", gap: 10 }}>
        <button className="glass-btn" style={{ padding: "11px 20px" }} onClick={onBack}>← Back</button>
        <button
          className="glass-btn glass-btn-primary"
          style={{ flex: 1, padding: "11px 20px", opacity: (!file || !accountId || loading) ? 0.5 : 1 }}
          onClick={handleImport}
          disabled={!file || !accountId || loading}
        >
          {loading ? "Importing…" : "Import Transactions"}
        </button>
        <button
          className="glass-btn"
          style={{ padding: "11px 20px", opacity: (!accountId || clearing) ? 0.5 : 1, color: "#f87171", borderColor: "rgba(248,113,113,0.25)" }}
          onClick={handleClear}
          disabled={!accountId || clearing}
          title="Remove all previously imported Maybe Finance transactions for this account"
        >
          {clearing ? "Clearing…" : "Clear"}
        </button>
      </div>
    </div>
  );
}

// ── ABN AMRO CAMT.053 statements ─────────────────────────────────────────────

const TRANSFER_MODES = [
  { id: "confirm", label: "Ask me",     desc: "Import normally, then show transfers I can confirm" },
  { id: "auto",    label: "Automatic",  desc: "Link them into transfers during import" },
  { id: "off",     label: "Off",        desc: "Treat every line as income or expense" },
];

function TransferCandidates({ candidates, onMerged }) {
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState([]);

  const merge = async (c) => {
    setBusy(c.outgoingId);
    try {
      await importApi.mergeTransfer(c.outgoingId, c.incomingId);
      setDone((d) => [...d, c.outgoingId]);
      onMerged?.();
    } finally {
      setBusy(null);
    }
  };

  const pending = candidates.filter((c) => !done.includes(c.outgoingId));
  if (pending.length === 0) return null;

  const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

  return (
    <div style={{
      borderRadius: 12, padding: "14px 18px",
      background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)",
    }}>
      <div style={{ fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}>
        {pending.length} possible transfer{pending.length !== 1 ? "s" : ""} between your own accounts
      </div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 12, lineHeight: 1.6 }}>
        These look like money moved between two accounts you own. Merging turns each pair into a
        single transfer, so it stops counting as both income and expense.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pending.map((c) => (
          <div key={c.outgoingId} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "9px 12px", borderRadius: 9, background: "rgba(255,255,255,0.04)", fontSize: 13,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{fmt(c.amount)}</div>
              <div style={{ color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.from.name} → {c.to.name} · {new Date(c.date).toLocaleDateString()}
              </div>
            </div>
            <button
              className="glass-btn"
              style={{ padding: "6px 14px", fontSize: 13, whiteSpace: "nowrap", opacity: busy === c.outgoingId ? 0.5 : 1 }}
              onClick={() => merge(c)}
              disabled={busy === c.outgoingId}
            >
              {busy === c.outgoingId ? "Merging…" : "Merge"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepAbnCamt({ onBack }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState(null); // null until the default loads
  const [candidates, setCandidates] = useState([]);
  const fileRef = useRef();

  useEffect(() => {
    accountsApi.list().then((a) => { setAccounts(a); if (a[0]) setAccountId(a[0].id); });
    configApi.get()
      .then((c) => setMode(c.transferDetection || "confirm"))
      .catch(() => setMode("confirm"));
  }, []);

  // Inspect as soon as files are picked, so the contents can be confirmed and
  // the account matching the statement IBAN preselected.
  const handleFiles = async (list) => {
    setFiles(list);
    setPreview(null);
    setResult(null);
    setCandidates([]);
    if (!list.length) return;
    setInspecting(true);
    try {
      const info = await importApi.camtInspect(list);
      setPreview(info);
      if (info.matchedAccount) setAccountId(info.matchedAccount.id);
    } catch (e) {
      setResult({ error: true, message: e.response?.data?.error || e.message });
    } finally {
      setInspecting(false);
    }
  };

  const handleImport = async () => {
    if (!files.length || !accountId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await importApi.camt(accountId, files, mode);
      const bits = [`✓ ${res.imported} transaction${res.imported !== 1 ? "s" : ""} imported`];
      if (res.fileCount > 1) bits.push(`from ${res.fileCount} files`);
      if (res.skipped) bits.push(`${res.skipped} skipped as duplicates`);
      if (res.transfersLinked) bits.push(`${res.transfersLinked} linked as transfers`);
      setResult({ message: bits.join(", ") });
      if (res.transferCandidates > 0) {
        setCandidates(await importApi.transferCandidates());
      }
    } catch (e) {
      setResult({ error: true, message: e.response?.data?.error || e.message });
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "?");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Import ABN AMRO statements</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          In ABN AMRO internet banking (Mijn ABN AMRO → <strong>Zelf regelen</strong>):
        </div>
        <ol style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.9, margin: "8px 0 0", paddingLeft: 20 }}>
          <li>Go to <strong>Overzichten en afschriften</strong></li>
          <li>Choose <strong>Bij- en afschrijvingen downloaden</strong></li>
          <li>Pick your account and period</li>
          <li>Choose file type <strong>CAMT.053 (XML)</strong> and download</li>
        </ol>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 10, lineHeight: 1.7 }}>
          ABN gives you one file per day, so select them all at once below. Re-importing the same
          period is safe — duplicates are skipped automatically.
        </div>
      </div>

      <MultiFileDropzone
        fileRef={fileRef} files={files} onFiles={handleFiles}
        accept=".xml" label="Drop your CAMT.053 .xml files here"
      />

      {inspecting && (
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Reading statements…</div>
      )}

      {preview && (
        <div style={{
          borderRadius: 12, padding: "14px 18px", fontSize: 13, lineHeight: 1.8,
          background: "rgba(99,102,241,0.08)", border: "1px solid rgba(129,140,248,0.25)",
        }}>
          <div style={{ fontWeight: 600, color: "#c7d2fe", marginBottom: 4 }}>
            {preview.fileCount} file{preview.fileCount !== 1 ? "s" : ""} read
          </div>
          <div style={{ color: "rgba(255,255,255,0.6)" }}>
            <div>{preview.count} transaction{preview.count !== 1 ? "s" : ""} · {fmtDate(preview.from)} → {fmtDate(preview.to)}</div>
            {preview.iban && <div>Account: {preview.iban}{preview.currency ? ` (${preview.currency})` : ""}</div>}
            {preview.multipleAccounts && (
              <div style={{ color: "#f87171" }}>
                These files cover different accounts ({preview.ibans.join(", ")}) — import one account at a time.
              </div>
            )}
            {!preview.multipleAccounts && (preview.matchedAccount
              ? <div style={{ color: "#6ee7b7" }}>Matched to “{preview.matchedAccount.name}” by IBAN</div>
              : preview.iban && <div style={{ color: "#fbbf24" }}>No account has this IBAN — pick the target below</div>)}
            {preview.errors?.length > 0 && (
              <div style={{ color: "#fbbf24" }}>{preview.errors.length} file(s) could not be read: {preview.errors[0]}</div>
            )}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Target Account</div>
        <select className="glass-input" style={{ padding: "10px 14px", width: "100%" }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
          Tip: set this account's IBAN to {preview?.iban || "the statement IBAN"} and it will be matched automatically next time.
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
          Transfers between your own accounts
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TRANSFER_MODES.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.desc}
                style={{
                  flex: "1 1 120px", padding: "9px 12px", borderRadius: 10, cursor: "pointer",
                  textAlign: "left", fontSize: 13,
                  border: `1px solid ${active ? "rgba(129,140,248,0.6)" : "rgba(255,255,255,0.1)"}`,
                  background: active ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.03)",
                  color: active ? "#c7d2fe" : "rgba(255,255,255,0.55)",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2, lineHeight: 1.4 }}>{m.desc}</div>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
          The default comes from Settings → Server and can be changed there.
        </div>
      </div>

      <ResultBanner result={result} onDismiss={() => setResult(null)} />
      <TransferCandidates candidates={candidates} />

      <div style={{ display: "flex", gap: 10 }}>
        <button className="glass-btn" style={{ padding: "11px 20px" }} onClick={onBack}>← Back</button>
        <button
          className="glass-btn glass-btn-primary"
          style={{ flex: 1, padding: "11px 20px", opacity: (!files.length || !accountId || loading || inspecting || preview?.multipleAccounts) ? 0.5 : 1 }}
          onClick={handleImport}
          disabled={!files.length || !accountId || loading || inspecting || preview?.multipleAccounts}
        >
          {loading ? "Importing…" : files.length > 1 ? `Import ${files.length} Statements` : "Import Statement"}
        </button>
      </div>
    </div>
  );
}

// ── FinTrack backup restore ──────────────────────────────────────────────────
function StepRestore({ onBack }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const handleRestore = async () => {
    if (!file) return;
    if (!window.confirm("This will replace ALL current data with the backup. This cannot be undone. Continue?")) return;
    setLoading(true);
    setError(null);
    try {
      await backupApi.restore(file);
      setDone(true);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontSize: 48 }}>✓</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#34d399" }}>Database restored</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Your data has been restored from the backup. Reload the page to see your data.</div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "12px 24px" }} onClick={() => window.location.reload()}>
          Reload Page
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Restore FinTrack Backup</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          Upload a <code>.db</code> backup file exported from FinTrack. All current data will be replaced with the backup contents.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
        <span style={{ fontSize: 16 }}>⚠</span>
        <div style={{ fontSize: 13, color: "rgba(251,191,36,0.85)", lineHeight: 1.6 }}>
          This is a destructive operation. All accounts, transactions, categories and settings will be overwritten. Make sure you have a recent backup of your current data before restoring.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Download your current data first:</div>
        <a
          href={backupApi.downloadUrl()}
          download
          style={{ fontSize: 13, color: "#818cf8", textDecoration: "none", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(129,140,248,0.3)" }}
        >
          Download backup
        </a>
      </div>

      <FileDropzone fileRef={fileRef} file={file} onFile={setFile} accept=".db" label="Drop .db backup file here" />

      {error && (
        <div style={{ fontSize: 13, color: "#f87171", padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="glass-btn" style={{ padding: "11px 20px" }} onClick={onBack}>← Back</button>
        <button
          className="glass-btn"
          style={{ flex: 1, padding: "11px 20px", opacity: (!file || loading) ? 0.5 : 1, color: "#f87171", borderColor: "rgba(248,113,113,0.3)", background: "rgba(239,68,68,0.08)" }}
          onClick={handleRestore}
          disabled={!file || loading}
        >
          {loading ? "Restoring…" : "Restore Database"}
        </button>
      </div>
    </div>
  );
}

// ── Main wizard ──────────────────────────────────────────────────────────────
export default function Import() {
  const [source, setSource] = useState(null); // "maybe" | "fintrack"
  const [step, setStep] = useState(0);

  const steps = source === "fintrack" ? STEPS_FINTRACK
    : source === "abn" ? STEPS_ABN
    : source === "maybe" ? STEPS_MAYBE
    : ["Source"];

  const chooseSource = (s) => { setSource(s); setStep(1); };
  const back = () => { if (step === 1) { setSource(null); setStep(0); } else setStep((s) => s - 1); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 620 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Import Data</h1>
        <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>Bring your financial data into FinTrack</p>
      </div>

      <StepIndicator steps={steps} current={step} />

      <GlassCard style={{ padding: "28px 28px" }}>
        {step === 0 && <StepSource onChoose={chooseSource} />}
        {source === "maybe" && step === 1 && <StepMaybeAccounts onDone={() => setStep(2)} onBack={back} />}
        {source === "maybe" && step === 2 && <StepMaybeTransactions onBack={back} />}
        {source === "abn" && step === 1 && <StepAbnCamt onBack={back} />}
        {source === "fintrack" && step === 1 && <StepRestore onBack={back} />}
      </GlassCard>
    </div>
  );
}
