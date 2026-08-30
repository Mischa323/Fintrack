// Auth token storage.
//
// "Keep me signed in" writes a persistent cookie that survives a browser restart;
// otherwise a session cookie the browser drops when it closes. The backend
// authenticates with an Authorization: Bearer header (not a cookie session), so
// the token is read back by JS and attached to each request — it is therefore
// deliberately not httpOnly. Stored in a cookie rather than localStorage so the
// session lifetime can follow the user's choice.

const KEY = "fintrack_token";

function readCookie() {
  const m = document.cookie.match(/(?:^|;\s*)fintrack_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function setToken(token, remember) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  let cookie = `${KEY}=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secure}`;
  // 30 days when remembering; no Max-Age = a session cookie cleared on browser close.
  if (remember) cookie += `; Max-Age=${30 * 24 * 60 * 60}`;
  document.cookie = cookie;
  try { localStorage.removeItem(KEY); } catch {}
}

export function getToken() {
  const cookie = readCookie();
  if (cookie) return cookie;
  // Migrate a token left in localStorage by an older version into a cookie.
  try {
    const legacy = localStorage.getItem(KEY);
    if (legacy) {
      setToken(legacy, true);
      localStorage.removeItem(KEY);
      return legacy;
    }
  } catch {}
  return null;
}

export function clearToken() {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${KEY}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  try { localStorage.removeItem(KEY); } catch {}
}
