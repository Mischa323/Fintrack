import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login, status, refreshStatus } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const setupMode = !status?.isSetup;
  const [confirmPassword, setConfirmPassword] = useState("");

  // Handle token returned from OIDC callback redirect (?token=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const err = params.get("error");
    if (token) {
      login(token);
      window.history.replaceState({}, "", "/login");
      navigate("/dashboard");
    } else if (err) {
      const messages = {
        sso_not_configured: "SSO is not configured yet",
        sso_failed: "Microsoft sign-in failed — please try again",
        google_sso_not_configured: "Google SSO is not configured yet",
        google_sso_failed: "Google sign-in failed — please try again",
      };
      setError(messages[err] || "Sign-in failed");
      window.history.replaceState({}, "", "/login");
    }
  }, [login, navigate]);

  async function handleSetup(e) {
    e.preventDefault();
    setError("");
    if (!username.trim() || username.trim().length < 2) return setError("Username must be at least 2 characters");
    if (password !== confirmPassword) return setError("Passwords do not match");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    setLoading(true);
    try {
      const res = await api.post("/auth/setup", { username: username.trim(), password });
      login(res.data.token);
      await refreshStatus();
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { username, password, totpCode: totpCode || undefined });
      if (res.data.requires2FA) {
        setNeeds2FA(true);
        setLoading(false);
        return;
      }
      login(res.data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleMicrosoftSSO() {
    window.location.href = "/api/auth/oidc/login";
  }

  function handleGoogleSSO() {
    window.location.href = "/api/auth/google/login";
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
  };

  const btnStyle = {
    width: "100%",
    padding: "11px",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(135deg,#818cf8,#a78bfa)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 15,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.7 : 1,
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="glass" style={{ width: 360, padding: "40px 36px", borderRadius: 16 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            fontSize: 26, fontWeight: 700,
            background: "linear-gradient(135deg,#818cf8,#a78bfa)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4,
          }}>
            FinTrack
          </div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>
            {setupMode ? "Create your password to get started" : needs2FA ? "Enter your authenticator code" : "Sign in to your finance tracker"}
          </div>
        </div>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {setupMode ? (
          <form onSubmit={handleSetup} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Username</label>
              <input style={inputStyle} type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose a username" autoFocus autoComplete="username" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Password</label>
              <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Confirm password</label>
              <input style={inputStyle} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" autoComplete="new-password" />
            </div>
            <button type="submit" style={{ ...btnStyle, marginTop: 8 }} disabled={loading}>
              {loading ? "Setting up…" : "Create password"}
            </button>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!needs2FA && (status?.oidcEnabled || status?.googleOidcEnabled) && (
              <>
                {status?.oidcEnabled && (
                  <button
                    onClick={handleMicrosoftSSO}
                    style={{
                      width: "100%", padding: "10px", borderRadius: 8, cursor: "pointer",
                      background: "#2f2f2f", border: "1px solid rgba(255,255,255,0.15)",
                      color: "#fff", fontWeight: 600, fontSize: 14,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    }}
                  >
                    <MicrosoftIcon />
                    Sign in with Microsoft
                  </button>
                )}
                {status?.googleOidcEnabled && (
                  <button
                    onClick={handleGoogleSSO}
                    style={{
                      width: "100%", padding: "10px", borderRadius: 8, cursor: "pointer",
                      background: "#fff", border: "1px solid rgba(255,255,255,0.15)",
                      color: "#1f1f1f", fontWeight: 600, fontSize: 14,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    }}
                  >
                    <GoogleIcon />
                    Sign in with Google
                  </button>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>or</span>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
                </div>
              </>
            )}

            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!needs2FA && (
                <>
                  <div>
                    <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Username</label>
                    <input style={inputStyle} type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Your username" autoFocus={!status?.oidcEnabled} autoComplete="username" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Password</label>
                    <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
                  </div>
                </>
              )}
              {needs2FA && (
                <div>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Authenticator code</label>
                  <input
                    style={{ ...inputStyle, letterSpacing: 6, textAlign: "center", fontSize: 20 }}
                    type="text" inputMode="numeric" maxLength={6}
                    value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000" autoFocus
                  />
                </div>
              )}
              <button type="submit" style={{ ...btnStyle, marginTop: 4 }} disabled={loading}>
                {loading ? "Signing in…" : needs2FA ? "Verify" : "Sign in"}
              </button>
              {needs2FA && (
                <button type="button" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 13 }}
                  onClick={() => { setNeeds2FA(false); setTotpCode(""); }}>
                  ← Back
                </button>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
