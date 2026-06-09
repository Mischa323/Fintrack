import { useState, useEffect } from "react";
import GlassCard from "../components/GlassCard";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { users as usersApi, backup as backupApi } from "../api/client";
import { useTheme, THEMES } from "../context/ThemeContext";

// ── Help system ───────────────────────────────────────────────

const GUIDES = {
  microsoftSso: {
    title: "Set up Microsoft Single Sign-On",
    intro: "Lets users sign in with a Microsoft / Azure AD account. You need admin access to the Azure Portal.",
    steps: [
      { step: "Open the Azure Portal", detail: "Go to portal.azure.com and sign in as an admin." },
      { step: "Register a new app", detail: 'Navigate to Azure Active Directory → App registrations → New registration. Give it a name like "FinTrack" and leave the default settings.' },
      { step: "Add the redirect URI", detail: 'Under Platform configurations, choose Web and paste the Redirect URI shown in FinTrack (above the form). It must match exactly — including the port number.' },
      { step: "Copy the IDs", detail: "From the Overview page, copy the Application (client) ID and Directory (tenant) ID. Paste both into FinTrack." },
      { step: "Create a client secret", detail: "Go to Certificates & secrets → New client secret. Set an expiry and click Add. Copy the Value immediately — it's only shown once." },
      { step: "Enable and save", detail: 'Paste the secret, check "Enable Microsoft SSO", and click Save.' },
    ],
    note: "If users get an error, double-check that the redirect URI in Azure matches the one shown in FinTrack exactly.",
  },
  googleSso: {
    title: "Set up Google Sign-In",
    intro: "Works for any Google account — personal Gmail or Google Workspace. You need a Google Cloud project (free).",
    steps: [
      { step: "Open Google Cloud Console", detail: "Go to console.cloud.google.com. Create a new project or select an existing one." },
      { step: "Configure the consent screen", detail: "Go to APIs & Services → OAuth consent screen. Choose External so any Google account can sign in. Fill in the app name and your email address." },
      { step: "Create OAuth credentials", detail: "Go to APIs & Services → Credentials → Create credentials → OAuth 2.0 Client ID. Select Web application." },
      { step: "Add the redirect URI", detail: "In Authorized redirect URIs, click Add URI and paste the callback URL shown in FinTrack settings." },
      { step: "Copy the credentials", detail: "After creating, a popup shows your Client ID and Client Secret. Copy both and paste them into FinTrack." },
      { step: "Enable and save", detail: 'Check "Enable Google SSO on the login page" and click Save.' },
    ],
    note: 'While your app is in "Testing" mode in Google Cloud, only added test users can sign in. To allow all Google accounts, go to OAuth consent screen → Publish App.',
  },
  backupSmb: {
    title: "SMB / Network share backup",
    intro: "Copies the database file directly to a Windows network share or any mapped drive.",
    steps: [
      { step: "Create a shared folder", detail: "On your NAS or Windows PC, create a folder and share it over the network." },
      { step: "Make the path accessible", detail: "FinTrack's server process must be able to reach the path." },
      { step: "Enter the destination path", detail: "Paste the full path into FinTrack.", code: "\\\\192.168.1.5\\Backups\\FinTrack" },
      { step: "Test it", detail: 'Enable the destination, save, and click "Run backup now".' },
    ],
    note: "Backups are timestamped files — old ones are not deleted automatically.",
  },
  backupSftp: {
    title: "SFTP backup",
    intro: "Uploads the database file to any server with SSH enabled.",
    steps: [
      { step: "Make sure SFTP is available", detail: "The server must have OpenSSH installed and running." },
      { step: "Create a dedicated user (optional)", detail: "For security, create a separate user with write access only to the backup folder." },
      { step: "Enter the host and port", detail: "Use the server's IP or hostname. Default SSH port is 22." },
      { step: "Enter credentials", detail: "Username and password of a user that has write access to the remote path." },
      { step: "Set the remote path", detail: "The directory on the remote server where backups go. It must already exist.", code: "/home/pi/fintrack-backups" },
      { step: "Test it", detail: 'Enable, save, and click "Run backup now" to verify the connection.' },
    ],
    note: "Each backup creates a new timestamped file. Old backups are not deleted automatically.",
  },
  backupOneDrive: {
    title: "OneDrive backup (Business)",
    intro: "Uploads backups to Microsoft 365 / SharePoint using app-only permissions.",
    steps: [
      { step: "Register an Azure app", detail: "In portal.azure.com, go to App registrations → New registration." },
      { step: "Add API permissions", detail: "Go to API permissions → Add a permission → Microsoft Graph → Application permissions → Files.ReadWrite.All. Then grant admin consent." },
      { step: "Create a client secret", detail: "Go to Certificates & secrets → New client secret. Copy the value." },
      { step: "Fill in FinTrack", detail: "Enter the Tenant ID, Client ID, Client Secret, optional Drive ID, and the folder name." },
      { step: "Test it", detail: 'Enable, save, and click "Run backup now".' },
    ],
    note: "Uses application permissions so no user interaction is needed after setup.",
  },
  backupGoogleDrive: {
    title: "Google Drive backup",
    intro: "Uploads backups to a Google Drive folder using a service account.",
    steps: [
      { step: "Create a Google Cloud project", detail: "Go to console.cloud.google.com and create or select a project." },
      { step: "Enable the Drive API", detail: "Go to APIs & Services → Library → search Google Drive API → Enable." },
      { step: "Create a service account", detail: "Go to APIs & Services → Credentials → Create credentials → Service account." },
      { step: "Download a JSON key", detail: "Click the service account → Keys tab → Add key → Create new key → JSON." },
      { step: "Share your backup folder", detail: "In Google Drive, create a folder. Share it with the service account email and give it Editor access." },
      { step: "Get the folder ID", detail: "Open the folder in Drive. Copy the ID from the URL.", code: "drive.google.com/drive/folders/[THIS_IS_THE_ID]" },
      { step: "Paste into FinTrack", detail: "Copy the JSON key contents and paste into the Service account JSON field." },
    ],
  },
  twoFactor: {
    title: "Set up two-factor authentication",
    intro: "Requires a one-time code from your phone at login.",
    steps: [
      { step: "Install an authenticator app", detail: "Download Google Authenticator, Authy, or Microsoft Authenticator." },
      { step: "Click Set up 2FA", detail: "FinTrack generates a secret and shows you a QR code." },
      { step: "Scan the QR code", detail: "Open the authenticator app and scan the QR code." },
      { step: "Enter the 6-digit code", detail: "Type the current code into FinTrack and click Verify & enable." },
      { step: "Done", detail: "Every future login will ask for your password first, then the 6-digit code." },
    ],
    note: "If you lose access to your phone, you will need to disable 2FA manually on the server.",
  },
  jwtSecret: {
    title: "JWT secret",
    intro: "The JWT secret signs login tokens. Changing it immediately invalidates all active sessions.",
    steps: [
      { step: "Leave blank to keep the current secret", detail: "If you don't enter anything, the existing secret is unchanged." },
      { step: "Generate a strong secret", detail: "Use a random string of at least 32 characters.", code: "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" },
      { step: "Save and restart", detail: "The new secret takes effect after a server restart. All users will need to sign in again." },
    ],
    note: "Never share or commit this secret.",
  },
};

function HelpModal({ guide, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", overflowY: "auto", padding: "24px 16px" }}>
      <div className="glass-strong" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, width: "100%", margin: "0 auto", borderRadius: 16, padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{guide.title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 2px", marginLeft: 12 }}>×</button>
        </div>
        {guide.intro && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 16px", lineHeight: 1.6 }}>{guide.intro}</p>}
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          {guide.steps.map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 12 }}>
              <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", marginTop: 1, background: "rgba(var(--c1),0.2)", border: "1px solid rgba(var(--c1),0.45)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--c1-full)" }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, color: "rgba(255,255,255,0.9)" }}>{s.step}</div>
                {s.detail && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.48)", lineHeight: 1.55 }}>{s.detail}</div>}
                {s.code && <code style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", background: "rgba(0,0,0,0.35)", borderRadius: 4, fontSize: 11, fontFamily: "monospace", wordBreak: "break-all", color: "#a5b4fc" }}>{s.code}</code>}
              </div>
            </li>
          ))}
        </ol>
        {guide.note && (
          <div style={{ marginTop: 16, padding: "9px 12px", borderRadius: 8, background: "rgba(var(--c1),0.08)", border: "1px solid rgba(var(--c1),0.2)", fontSize: 12, color: "rgba(255,255,255,0.48)", lineHeight: 1.55 }}>
            <strong style={{ color: "rgba(255,255,255,0.65)" }}>Note: </strong>{guide.note}
          </div>
        )}
      </div>
    </div>
  );
}

function HelpButton({ guide }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Show guide" style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, background: "rgba(var(--c1),0.15)", border: "1px solid rgba(var(--c1),0.35)", color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>?</button>
      {open && <HelpModal guide={guide} onClose={() => setOpen(false)} />}
    </>
  );
}

function SectionTitle({ children, help }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{children}</h2>
      {help && <HelpButton guide={help} />}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", margin: "28px 0" }} />;
}

function Field({ label, children, help }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {label}{help && <HelpButton guide={help} />}
      </label>
      {children}
    </div>
  );
}

const inp = { width: "100%", padding: "9px 13px", fontSize: 14, boxSizing: "border-box" };
const sel = { ...inp, padding: "9px 10px" };

function Alert({ type, message }) {
  if (!message) return null;
  const isError = type === "error";
  return (
    <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16, background: isError ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)", border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`, color: isError ? "#fca5a5" : "#86efac" }}>
      {message}
    </div>
  );
}

// ── Theme Selector ────────────────────────────────────────────
function ThemeSelector() {
  const { theme, setTheme, custom, setCustomColors } = useTheme();
  const [c1, setC1] = useState(custom?.c1 || "#6366f1");
  const [c2, setC2] = useState(custom?.c2 || "#8b5cf6");

  return (
    <>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 16px" }}>Pick a preset or mix your own accent colors.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
        {THEMES.map(t => {
          const active = theme === t.id;
          return (
            <button key={t.id} onClick={() => setTheme(t.id)} style={{ border: `2px solid ${active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.08)"}`, borderRadius: 12, padding: 0, cursor: "pointer", overflow: "hidden", background: "none", outline: "none", transition: "border-color 0.2s" }}>
              <div style={{ height: 64, background: `radial-gradient(ellipse at 20% 30%, ${t.colors[0]}66 0%, transparent 60%), radial-gradient(ellipse at 80% 70%, ${t.colors[1]}55 0%, transparent 55%), ${t.base}` }} />
              <div style={{ padding: "6px 10px 8px", background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: active ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: active ? 600 : 400 }}>{t.label}</span>
                <div style={{ display: "flex", gap: 3 }}>{t.colors.slice(0, 3).map((c, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />)}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16 }}>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 10, fontWeight: 500 }}>
          Custom colors
          {theme === "custom" && <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(var(--c1),1)", background: "rgba(var(--c1),0.15)", padding: "2px 7px", borderRadius: 4 }}>active</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.6)", cursor: "pointer" }}>
            Primary <input type="color" value={c1} onChange={e => setC1(e.target.value)} style={{ width: 36, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", padding: 2, background: "transparent" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.6)", cursor: "pointer" }}>
            Secondary <input type="color" value={c2} onChange={e => setC2(e.target.value)} style={{ width: 36, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", padding: 2, background: "transparent" }} />
          </label>
          <div style={{ width: 48, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${c1}, ${c2})`, border: "1px solid rgba(255,255,255,0.15)" }} />
          <button className="glass-btn glass-btn-primary" style={{ padding: "5px 14px", fontSize: 13 }} onClick={() => setCustomColors({ c1, c2 })}>Apply</button>
        </div>
      </div>
    </>
  );
}

// ── Change Password ──────────────────────────────────────────
function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);
    if (form.newPassword !== form.confirmPassword) return setMsg({ type: "error", text: "Passwords do not match" });
    if (form.newPassword.length < 6) return setMsg({ type: "error", text: "Password must be at least 6 characters" });
    try {
      await api.post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setMsg({ type: "success", text: "Password updated successfully" });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setMsg({ type: "error", text: err.response?.data?.error || "Failed to change password" });
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Alert type={msg?.type} message={msg?.text} />
      <Field label="Current password"><input className="glass-input" style={inp} type="password" value={form.currentPassword} onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))} /></Field>
      <Field label="New password"><input className="glass-input" style={inp} type="password" value={form.newPassword} onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))} /></Field>
      <Field label="Confirm new password"><input className="glass-input" style={inp} type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} /></Field>
      <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }}>Update password</button>
    </form>
  );
}

// ── 2FA Setup ────────────────────────────────────────────────
function TwoFactorSetup({ enabled, onChanged }) {
  const [step, setStep] = useState("idle");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [msg, setMsg] = useState(null);

  async function startSetup() {
    setMsg(null);
    try {
      const res = await api.post("/auth/2fa/generate");
      setQrCode(res.data.qrCode); setSecret(res.data.secret); setStep("scan");
    } catch { setMsg({ type: "error", text: "Failed to generate 2FA secret" }); }
  }

  async function verifyAndEnable(e) {
    e.preventDefault(); setMsg(null);
    try {
      await api.post("/auth/2fa/enable", { totpCode: code });
      setMsg({ type: "success", text: "Two-factor authentication enabled!" });
      setStep("idle"); setCode(""); onChanged();
    } catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Invalid code" }); }
  }

  async function disable(e) {
    e.preventDefault(); setMsg(null);
    try {
      await api.post("/auth/2fa/disable", { password: disablePassword });
      setMsg({ type: "success", text: "Two-factor authentication disabled" });
      setStep("idle"); setDisablePassword(""); onChanged();
    } catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Incorrect password" }); }
  }

  if (enabled) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>✓</span>
          <span style={{ color: "#86efac", fontWeight: 600 }}>Two-factor authentication is enabled</span>
        </div>
        <Alert type={msg?.type} message={msg?.text} />
        {step === "disable" ? (
          <form onSubmit={disable}>
            <Field label="Confirm your password to disable 2FA">
              <input className="glass-input" style={inp} type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} autoFocus />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="glass-btn glass-btn-danger" style={{ padding: "9px 20px" }}>Disable 2FA</button>
              <button type="button" className="glass-btn glass-btn-ghost" style={{ padding: "9px 20px" }} onClick={() => setStep("idle")}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="glass-btn glass-btn-danger" style={{ padding: "9px 20px" }} onClick={() => setStep("disable")}>Disable 2FA</button>
        )}
      </>
    );
  }

  return (
    <>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 20px" }}>Add an extra layer of security. You'll need an authenticator app like Google Authenticator or Authy.</p>
      <Alert type={msg?.type} message={msg?.text} />
      {step === "idle" && <button className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }} onClick={startSetup}>Set up 2FA</button>}
      {step === "scan" && (
        <>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 16 }}>Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <img src={qrCode} alt="2FA QR code" style={{ borderRadius: 8, background: "#fff", padding: 8 }} />
          </div>
          <details style={{ marginBottom: 20 }}>
            <summary style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer" }}>Can't scan? Enter code manually</summary>
            <code style={{ display: "block", marginTop: 8, padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 6, fontSize: 13, letterSpacing: 2, wordBreak: "break-all" }}>{secret}</code>
          </details>
          <form onSubmit={verifyAndEnable}>
            <Field label="6-digit verification code">
              <input className="glass-input" style={{ ...inp, letterSpacing: 6, textAlign: "center", fontSize: 20 }} type="text" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }}>Verify &amp; enable</button>
              <button type="button" className="glass-btn glass-btn-ghost" style={{ padding: "9px 20px" }} onClick={() => { setStep("idle"); setMsg(null); }}>Cancel</button>
            </div>
          </form>
        </>
      )}
    </>
  );
}

// ── User Management ──────────────────────────────────────────
function UserManagement({ currentUserId }) {
  const [userList, setUserList] = useState([]);
  const [form, setForm] = useState({ username: "", password: "", role: "user" });
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() { try { setUserList(await usersApi.list()); } catch {} }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      await usersApi.create(form);
      setMsg({ type: "success", text: `User "${form.username}" created` });
      setForm({ username: "", password: "", role: "user" }); load();
    } catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to create user" }); }
    finally { setLoading(false); }
  }

  async function handleDelete(id, username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    try { await usersApi.remove(id); load(); }
    catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to delete user" }); }
  }

  async function handleRoleChange(id, newRole) {
    try { await usersApi.update(id, { role: newRole }); load(); }
    catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to update role" }); }
  }

  return (
    <>
      <div style={{ marginBottom: 24, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["Username", "Role", "2FA", "Created", ""].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {userList.map(u => (
              <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "10px 8px" }}>
                  {u.username}
                  {u.id === currentUserId && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--c1-full)" }}>you</span>}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)} disabled={u.id === currentUserId}
                    className="glass-input" style={{ padding: "3px 8px", fontSize: 13 }}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td style={{ padding: "10px 8px", color: u.twoFactorEnabled ? "#86efac" : "rgba(255,255,255,0.3)" }}>{u.twoFactorEnabled ? "✓ On" : "Off"}</td>
                <td style={{ padding: "10px 8px", color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: "10px 8px" }}>
                  {u.id !== currentUserId && <button onClick={() => handleDelete(u.id, u.username)} className="glass-btn glass-btn-danger" style={{ padding: "4px 12px", fontSize: 12 }}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Divider />
      <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 14 }}>Add user</div>
      <Alert type={msg?.type} message={msg?.text} />
      <form onSubmit={handleCreate}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 10, alignItems: "end" }}>
          <Field label="Username"><input className="glass-input" style={inp} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="username" /></Field>
          <Field label="Password"><input className="glass-input" style={inp} type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 6 characters" /></Field>
          <Field label="Role">
            <select className="glass-input" style={sel} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        </div>
        <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px", marginTop: 8 }} disabled={loading}>{loading ? "Creating…" : "Create user"}</button>
      </form>
    </>
  );
}

// ── Server Config ─────────────────────────────────────────────
function ServerConfig() {
  const [config, setConfig] = useState({ appName: "", defaultCurrency: "", appPort: "", jwtSecret: "" });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get("/config").then(res => {
      setConfig({ appName: res.data.appName ?? "FinTrack", defaultCurrency: res.data.defaultCurrency ?? "EUR", appPort: res.data.appPort ?? "", jwtSecret: "" });
      setLoaded(true);
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault(); setMsg(null);
    try {
      const res = await api.put("/config", { appName: config.appName, defaultCurrency: config.defaultCurrency, appPort: config.appPort ? Number(config.appPort) : undefined, jwtSecret: config.jwtSecret || undefined });
      setMsg({ type: "success", text: res.data.note || "Configuration saved" });
      setConfig(c => ({ ...c, jwtSecret: "" }));
    } catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to save config" }); }
  }

  if (!loaded) return <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>Loading…</p>;

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ background: "rgba(var(--c1),0.08)", border: "1px solid rgba(var(--c1),0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
        Port and JWT secret changes require a server restart to take effect.
      </div>
      <Alert type={msg?.type} message={msg?.text} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="App name"><input className="glass-input" style={inp} value={config.appName} onChange={e => setConfig(c => ({ ...c, appName: e.target.value }))} /></Field>
        <Field label="Default currency"><input className="glass-input" style={inp} value={config.defaultCurrency} onChange={e => setConfig(c => ({ ...c, defaultCurrency: e.target.value.toUpperCase() }))} maxLength={3} placeholder="EUR" /></Field>
        <Field label="Server port"><input className="glass-input" style={inp} type="number" value={config.appPort} onChange={e => setConfig(c => ({ ...c, appPort: e.target.value }))} placeholder="3001" /></Field>
        <Field label="JWT secret (leave blank to keep current)" help={GUIDES.jwtSecret}><input className="glass-input" style={inp} type="password" value={config.jwtSecret} onChange={e => setConfig(c => ({ ...c, jwtSecret: e.target.value }))} placeholder="New secret…" /></Field>
      </div>
      <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px", marginTop: 4 }}>Save configuration</button>
    </form>
  );
}

// ── SSO / Microsoft ──────────────────────────────────────────
function SsoConfig() {
  const [cfg, setCfg] = useState({ oidcEnabled: false, oidcTenantId: "", oidcClientId: "", oidcClientSecret: "", hasOidcClientSecret: false });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(null);
  const callbackUrl = `${window.location.protocol}//${window.location.hostname}:3001/auth/oidc/callback`;

  useEffect(() => {
    api.get("/config").then(res => {
      setCfg({ oidcEnabled: res.data.oidcEnabled ?? false, oidcTenantId: res.data.oidcTenantId ?? "", oidcClientId: res.data.oidcClientId ?? "", oidcClientSecret: "", hasOidcClientSecret: res.data.hasOidcClientSecret ?? false });
      setLoaded(true);
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault(); setMsg(null);
    try {
      await api.put("/config", { oidcEnabled: cfg.oidcEnabled, oidcTenantId: cfg.oidcTenantId || undefined, oidcClientId: cfg.oidcClientId || undefined, oidcClientSecret: cfg.oidcClientSecret || undefined });
      setMsg({ type: "success", text: "SSO configuration saved" });
      setCfg(c => ({ ...c, oidcClientSecret: "", hasOidcClientSecret: c.hasOidcClientSecret || !!c.oidcClientSecret }));
    } catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to save" }); }
  }

  if (!loaded) return <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>Loading…</p>;

  return (
    <form onSubmit={handleSubmit}>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 20px" }}>Allow users to sign in with their Microsoft / Azure AD account.</p>
      <Alert type={msg?.type} message={msg?.text} />
      <Field label="Redirect URI — add this to your Azure app registration">
        <div className="glass-input" style={{ ...inp, color: "rgba(255,255,255,0.5)", userSelect: "all", cursor: "text", fontSize: 13 }}>{callbackUrl}</div>
      </Field>
      <Field label="Tenant ID (Directory ID)"><input className="glass-input" style={inp} value={cfg.oidcTenantId} onChange={e => setCfg(c => ({ ...c, oidcTenantId: e.target.value }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>
      <Field label="Client ID (Application ID)"><input className="glass-input" style={inp} value={cfg.oidcClientId} onChange={e => setCfg(c => ({ ...c, oidcClientId: e.target.value }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>
      <Field label={`Client secret${cfg.hasOidcClientSecret ? " (leave blank to keep current)" : ""}`}>
        <input className="glass-input" style={inp} type="password" value={cfg.oidcClientSecret} onChange={e => setCfg(c => ({ ...c, oidcClientSecret: e.target.value }))} placeholder={cfg.hasOidcClientSecret ? "••••••••" : "Paste client secret…"} />
      </Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "rgba(255,255,255,0.8)", marginBottom: 20 }}>
        <input type="checkbox" checked={cfg.oidcEnabled} onChange={e => setCfg(c => ({ ...c, oidcEnabled: e.target.checked }))} style={{ accentColor: "#818cf8", width: 16, height: 16 }} />
        Enable Microsoft SSO on the login page
      </label>
      <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }}>Save SSO configuration</button>
    </form>
  );
}

// ── SSO / Google ─────────────────────────────────────────────
function GoogleSsoConfig() {
  const [cfg, setCfg] = useState({ googleOidcEnabled: false, googleClientId: "", googleClientSecret: "", hasGoogleClientSecret: false });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(null);
  const callbackUrl = `${window.location.protocol}//${window.location.hostname}:3001/auth/google/callback`;

  useEffect(() => {
    api.get("/config").then(res => {
      setCfg({ googleOidcEnabled: res.data.googleOidcEnabled ?? false, googleClientId: res.data.googleClientId ?? "", googleClientSecret: "", hasGoogleClientSecret: res.data.hasGoogleClientSecret ?? false });
      setLoaded(true);
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault(); setMsg(null);
    try {
      await api.put("/config", { googleOidcEnabled: cfg.googleOidcEnabled, googleClientId: cfg.googleClientId || undefined, googleClientSecret: cfg.googleClientSecret || undefined });
      setMsg({ type: "success", text: "Google SSO configuration saved" });
      setCfg(c => ({ ...c, googleClientSecret: "", hasGoogleClientSecret: c.hasGoogleClientSecret || !!c.googleClientSecret }));
    } catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to save" }); }
  }

  if (!loaded) return <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>Loading…</p>;

  return (
    <form onSubmit={handleSubmit}>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 20px" }}>Allow anyone to sign in with their Google account — personal Gmail or Google Workspace.</p>
      <Alert type={msg?.type} message={msg?.text} />
      <Field label="Authorized redirect URI — add this in Google Cloud Console">
        <div className="glass-input" style={{ ...inp, color: "rgba(255,255,255,0.5)", userSelect: "all", cursor: "text", fontSize: 13 }}>{callbackUrl}</div>
      </Field>
      <Field label="Client ID"><input className="glass-input" style={inp} value={cfg.googleClientId} onChange={e => setCfg(c => ({ ...c, googleClientId: e.target.value }))} placeholder="xxxxxxxxxx-xxxx.apps.googleusercontent.com" /></Field>
      <Field label={`Client secret${cfg.hasGoogleClientSecret ? " (leave blank to keep current)" : ""}`}>
        <input className="glass-input" style={inp} type="password" value={cfg.googleClientSecret} onChange={e => setCfg(c => ({ ...c, googleClientSecret: e.target.value }))} placeholder={cfg.hasGoogleClientSecret ? "••••••••" : "Paste client secret…"} />
      </Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "rgba(255,255,255,0.8)", marginBottom: 20 }}>
        <input type="checkbox" checked={cfg.googleOidcEnabled} onChange={e => setCfg(c => ({ ...c, googleOidcEnabled: e.target.checked }))} style={{ accentColor: "#818cf8", width: 16, height: 16 }} />
        Enable Google SSO on the login page
      </label>
      <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }}>Save Google SSO configuration</button>
    </form>
  );
}

// ── Backup Manager ────────────────────────────────────────────
const BACKUP_TYPES = [
  { value: "smb", label: "SMB / Network share" },
  { value: "sftp", label: "SFTP" },
  { value: "onedrive", label: "OneDrive (Business)" },
  { value: "googledrive", label: "Google Drive" },
];

function BackupConfigForm({ initial, onSave, onCancel }) {
  const defaultConfig = {
    smb: { path: "" },
    sftp: { host: "", port: "22", username: "", password: "", remotePath: "/backups" },
    onedrive: { tenantId: "", clientId: "", clientSecret: "", driveId: "", folder: "FinTrack" },
    googledrive: { serviceAccountJson: "", folderId: "" },
  };
  const [label, setLabel] = useState(initial?.label || "");
  const [type, setType] = useState(initial?.type || "sftp");
  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [config, setConfig] = useState(() => { if (initial?.configJson) { try { return JSON.parse(initial.configJson); } catch {} } return defaultConfig[initial?.type || "sftp"]; });
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const setField = (key, value) => setConfig(c => ({ ...c, [key]: value }));

  function handleTypeChange(newType) { setType(newType); setConfig(defaultConfig[newType]); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!label.trim()) return setMsg({ type: "error", text: "Label is required" });
    setSaving(true); setMsg(null);
    try { await onSave({ label, type, enabled, configJson: JSON.stringify(config) }); }
    catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to save" }); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 20, border: "1px solid rgba(255,255,255,0.08)" }}>
      <Alert type={msg?.type} message={msg?.text} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label="Label"><input className="glass-input" style={inp} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. NAS backup" /></Field>
        <Field label="Type" help={GUIDES[{ smb: "backupSmb", sftp: "backupSftp", onedrive: "backupOneDrive", googledrive: "backupGoogleDrive" }[type]]}>
          <select className="glass-input" style={sel} value={type} onChange={e => handleTypeChange(e.target.value)}>
            {BACKUP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </div>

      {type === "smb" && <Field label="Destination path"><input className="glass-input" style={inp} value={config.path || ""} onChange={e => setField("path", e.target.value)} placeholder="\\\\server\\share\\backups" /></Field>}

      {type === "sftp" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
          <Field label="Host"><input className="glass-input" style={inp} value={config.host || ""} onChange={e => setField("host", e.target.value)} placeholder="192.168.1.10" /></Field>
          <Field label="Port"><input className="glass-input" style={inp} value={config.port || "22"} onChange={e => setField("port", e.target.value)} /></Field>
          <Field label="Username"><input className="glass-input" style={inp} value={config.username || ""} onChange={e => setField("username", e.target.value)} /></Field>
          <Field label="Password"><input className="glass-input" style={inp} type="password" value={config.password || ""} onChange={e => setField("password", e.target.value)} placeholder="••••••••" /></Field>
          <Field label="Remote path" style={{ gridColumn: "span 2" }}><input className="glass-input" style={inp} value={config.remotePath || "/backups"} onChange={e => setField("remotePath", e.target.value)} /></Field>
        </div>
      )}

      {type === "onedrive" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Tenant ID"><input className="glass-input" style={inp} value={config.tenantId || ""} onChange={e => setField("tenantId", e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>
            <Field label="Client ID"><input className="glass-input" style={inp} value={config.clientId || ""} onChange={e => setField("clientId", e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>
            <Field label="Client secret"><input className="glass-input" style={inp} type="password" value={config.clientSecret || ""} onChange={e => setField("clientSecret", e.target.value)} placeholder="••••••••" /></Field>
            <Field label="Drive ID (optional)"><input className="glass-input" style={inp} value={config.driveId || ""} onChange={e => setField("driveId", e.target.value)} placeholder="b!abc123..." /></Field>
            <Field label="Folder"><input className="glass-input" style={inp} value={config.folder || "FinTrack"} onChange={e => setField("folder", e.target.value)} /></Field>
          </div>
        </>
      )}

      {type === "googledrive" && (
        <>
          <Field label="Service account JSON key">
            <textarea className="glass-input" style={{ ...inp, height: 120, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} value={config.serviceAccountJson || ""} onChange={e => setField("serviceAccountJson", e.target.value)} placeholder='{"type":"service_account",...}' />
          </Field>
          <Field label="Target folder ID"><input className="glass-input" style={inp} value={config.folderId || ""} onChange={e => setField("folderId", e.target.value)} /></Field>
        </>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 8, marginBottom: 16 }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ accentColor: "#818cf8", width: 16, height: 16 }} />
        Enabled (runs automatically at 2:00 AM daily)
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="glass-btn glass-btn-ghost" style={{ padding: "9px 20px" }} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function BackupManager() {
  const [configs, setConfigs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const [running, setRunning] = useState(false);

  async function load() { try { setConfigs(await backupApi.list()); } catch {} }
  useEffect(() => { load(); }, []);

  async function handleRunNow() {
    setRunning(true); setMsg(null);
    try { await backupApi.run(); setMsg({ type: "success", text: "Backup started in the background" }); setTimeout(load, 3000); }
    catch (err) { setMsg({ type: "error", text: err.response?.data?.error || "Failed to start backup" }); }
    finally { setRunning(false); }
  }

  return (
    <>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 16px" }}>Automatically back up the SQLite database to one or more destinations daily at 2:00 AM.</p>
      <Alert type={msg?.type} message={msg?.text} />

      {configs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {configs.map(cfg => (
            editing?.id === cfg.id ? (
              <BackupConfigForm key={cfg.id} initial={cfg} onSave={async (data) => { await backupApi.update(cfg.id, data); setEditing(null); load(); }} onCancel={() => setEditing(null)} />
            ) : (
              <div key={cfg.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{cfg.label}</span>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: cfg.enabled ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)", color: cfg.enabled ? "#86efac" : "rgba(255,255,255,0.3)" }}>{cfg.enabled ? "enabled" : "disabled"}</span>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: "rgba(var(--c1),0.12)", color: "rgba(255,255,255,0.6)" }}>{BACKUP_TYPES.find(t => t.value === cfg.type)?.label || cfg.type}</span>
                  </div>
                  {cfg.lastRunAt && (
                    <div style={{ fontSize: 12, color: cfg.lastStatus === "success" ? "#86efac" : "rgba(239,68,68,0.8)" }}>
                      Last run: {new Date(cfg.lastRunAt).toLocaleString()} — {cfg.lastStatus === "success" ? "✓ OK" : `✗ ${cfg.lastStatus}`}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => setEditing(cfg)}>Edit</button>
                  <button className="glass-btn glass-btn-danger" style={{ padding: "6px 14px", fontSize: 13 }} onClick={async () => { if (!confirm(`Delete backup destination "${cfg.label}"?`)) return; await backupApi.remove(cfg.id); load(); }}>Delete</button>
                </div>
              </div>
            )
          ))}
        </div>
      )}

      {adding ? (
        <BackupConfigForm onSave={async (data) => { await backupApi.create(data); setAdding(false); load(); }} onCancel={() => setAdding(false)} />
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="glass-btn glass-btn-primary" style={{ padding: "9px 20px" }} onClick={() => setAdding(true)}>+ Add destination</button>
          {configs.length > 0 && <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 20px" }} onClick={handleRunNow} disabled={running}>{running ? "Running…" : "Run backup now"}</button>}
        </div>
      )}
    </>
  );
}

// ── Main Settings page ───────────────────────────────────────
const NAV_TABS = [
  { id: "appearance", label: "Appearance", icon: "🎨" },
  { id: "security",   label: "Security",   icon: "🔐" },
  { id: "users",      label: "Users",      icon: "👥", adminOnly: true },
  { id: "server",     label: "Server",     icon: "⚙",  adminOnly: true },
  { id: "sso",        label: "SSO",        icon: "🔑", adminOnly: true },
  { id: "backups",    label: "Backups",    icon: "💾", adminOnly: true },
];

export default function Settings() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [activeTab, setActiveTab] = useState("appearance");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get("/auth/me").then(res => setTwoFactorEnabled(res.data.twoFactorEnabled));
  }, [user]);

  const tabs = NAV_TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Settings</h1>
        <p style={{ margin: "4px 0 0", color: "rgba(255,255,255,0.45)", fontSize: 14 }}>
          Signed in as <strong style={{ color: "rgba(255,255,255,0.8)" }}>{user?.username}</strong>
          {isAdmin && <span style={{ marginLeft: 8, fontSize: 11, background: "rgba(var(--c1),0.2)", color: "var(--c1-full)", padding: "2px 7px", borderRadius: 4 }}>admin</span>}
        </p>
      </div>

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "8px 16px", borderRadius: 12, fontSize: 13, fontWeight: active ? 600 : 400,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s",
                border: active ? "1px solid rgba(129,140,248,0.5)" : "1px solid rgba(255,255,255,0.1)",
                background: active ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                color: active ? "#c7d2fe" : "rgba(255,255,255,0.5)",
              }}
            >
              <span>{t.icon}</span>{t.label}
            </button>
          );
        })}
      </div>

      {/* Content card */}
      <GlassCard style={{ padding: "28px 28px" }}>
        {activeTab === "appearance" && (
          <>
            <SectionTitle>Appearance</SectionTitle>
            <ThemeSelector />
          </>
        )}

        {activeTab === "security" && (
          <>
            <SectionTitle>Change password</SectionTitle>
            <ChangePassword />
            <Divider />
            <SectionTitle help={GUIDES.twoFactor}>Two-factor authentication</SectionTitle>
            <TwoFactorSetup
              enabled={twoFactorEnabled}
              onChanged={async () => { const res = await api.get("/auth/me"); setTwoFactorEnabled(res.data.twoFactorEnabled); }}
            />
            <Divider />
            <SectionTitle>Session</SectionTitle>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 16px" }}>
              You are currently signed in. Signing out will require your password to access FinTrack again.
            </p>
            <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 20px" }} onClick={logout}>Sign out</button>
          </>
        )}

        {isAdmin && activeTab === "users" && (
          <>
            <SectionTitle>Users</SectionTitle>
            <UserManagement currentUserId={user?.userId} />
          </>
        )}

        {isAdmin && activeTab === "server" && (
          <>
            <SectionTitle>Server configuration</SectionTitle>
            <ServerConfig />
          </>
        )}

        {isAdmin && activeTab === "sso" && (
          <>
            <SectionTitle help={GUIDES.microsoftSso}>Microsoft SSO</SectionTitle>
            <SsoConfig />
            <Divider />
            <SectionTitle help={GUIDES.googleSso}>Google Sign-In</SectionTitle>
            <GoogleSsoConfig />
          </>
        )}

        {isAdmin && activeTab === "backups" && (
          <>
            <SectionTitle>Database backups</SectionTitle>
            <BackupManager />
          </>
        )}
      </GlassCard>
    </div>
  );
}
