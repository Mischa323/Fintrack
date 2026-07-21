import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("fintrack_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token and redirect to login
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes("/auth/")) {
      localStorage.removeItem("fintrack_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const accounts = {
  list: () => api.get("/accounts").then((r) => r.data),
  create: (data) => api.post("/accounts", data).then((r) => r.data),
  update: (id, data) => api.put(`/accounts/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/accounts/${id}`),
  recalculate: (id) => api.post(`/accounts/${id}/recalculate`).then((r) => r.data),
  reconcile: (id, balance) => api.post(`/accounts/${id}/reconcile`, { balance }).then((r) => r.data),
};

export const transactions = {
  list: (params) => api.get("/transactions", { params }).then((r) => r.data),
  create: (data) => api.post("/transactions", data).then((r) => r.data),
  update: (id, data) => api.put(`/transactions/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/transactions/${id}`),
  bulkRemove: (ids) => api.post("/transactions/bulk-delete", { ids }).then((r) => r.data),
  bulkUpdate: (ids, changes) =>
    api.patch("/transactions/bulk", { ids, ...changes }).then((r) => r.data),
};

export const categories = {
  list: () => api.get("/categories").then((r) => r.data),
  create: (data) => api.post("/categories", data).then((r) => r.data),
  update: (id, data) => api.put(`/categories/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/categories/${id}`),
  seed: () => api.post("/categories/seed").then((r) => r.data),
  flat: () => api.get("/categories/flat").then((r) => r.data),
  merge: (sourceIds, targetId) =>
    api.post("/categories/merge", { sourceIds, targetId }).then((r) => r.data),
};

export const recurring = {
  list: () => api.get("/recurring").then((r) => r.data),
  create: (data) => api.post("/recurring", data).then((r) => r.data),
  update: (id, data) => api.put(`/recurring/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/recurring/${id}`),
};

export const stats = {
  overview: (params) => api.get("/stats/overview", { params }).then((r) => r.data),
  monthly: (params) => api.get("/stats/monthly", { params }).then((r) => r.data),
};

export const importApi = {
  maybe: (accountId, file, accountMap) => {
    const form = new FormData();
    if (accountId) form.append("accountId", accountId);
    if (accountMap) form.append("accountMap", JSON.stringify(accountMap));
    form.append("file", file);
    return api.post("/import/maybe", form).then((r) => r.data);
  },
  maybeInspect: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/import/maybe/inspect", form).then((r) => r.data);
  },
  generic: (accountId, file) => {
    const form = new FormData();
    form.append("accountId", accountId);
    form.append("file", file);
    return api.post("/import/generic", form).then((r) => r.data);
  },
  camtInspect: (files) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return api.post("/import/camt/inspect", form).then((r) => r.data);
  },
  camt: (accountId, files, transferMode) => {
    const form = new FormData();
    form.append("accountId", accountId);
    if (transferMode) form.append("transferMode", transferMode);
    for (const f of files) form.append("files", f);
    return api.post("/import/camt", form).then((r) => r.data);
  },
  transferCandidates: () => api.get("/import/transfers/candidates").then((r) => r.data),
  unlinkedIbans: () => api.get("/import/transfers/unlinked-ibans").then((r) => r.data),
  convertTransfer: (id) => api.post("/import/transfers/convert", { id }).then((r) => r.data),
  mergeTransfer: (outgoingId, incomingId) =>
    api.post("/import/transfers/merge", { outgoingId, incomingId }).then((r) => r.data),
  clear: (accountId, source) =>
    api.delete("/import/clear", { params: { accountId, source } }).then((r) => r.data),
  maybeAccounts: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/import/maybe-accounts", form).then((r) => r.data);
  },
};

export const receipts = {
  list: (status) => api.get("/receipts", { params: { status } }).then((r) => r.data),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/receipts", form).then((r) => r.data);
  },
  // Fetched as a blob rather than used as an <img src>: every route sits behind
  // JWT auth, and an img tag cannot send the Authorization header.
  image: (id) =>
    api.get("/receipts/" + id + "/image", { responseType: "blob" }).then((r) => URL.createObjectURL(r.data)),
  link: (id, transactionId) => api.post("/receipts/" + id + "/link", { transactionId }).then((r) => r.data),
  unlink: (id) => api.post("/receipts/" + id + "/unlink").then((r) => r.data),
  rematch: (id) => api.post("/receipts/" + id + "/rematch").then((r) => r.data),
  dismiss: (id) => api.post("/receipts/" + id + "/dismiss").then((r) => r.data),
  createTransaction: (id, data) => api.post("/receipts/" + id + "/create-transaction", data).then((r) => r.data),
  remove: (id) => api.delete("/receipts/" + id),
};

export const holdings = {
  list: (accountId) => api.get("/holdings", { params: { accountId } }).then((r) => r.data),
  create: (data) => api.post("/holdings", data).then((r) => r.data),
  update: (id, data) => api.put(`/holdings/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/holdings/${id}`),
  refresh: (accountId) => api.post("/holdings/refresh", { accountId }).then((r) => r.data),
  importTrades: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/holdings/import/trades", form).then((r) => r.data);
  },
  trades: (holdingId) => api.get(`/holdings/${holdingId}/trades`).then((r) => r.data),
  addTrade: (holdingId, data) => api.post(`/holdings/${holdingId}/trades`, data).then((r) => r.data),
  removeTrade: (holdingId, tradeId) => api.delete(`/holdings/${holdingId}/trades/${tradeId}`),
  importRevolut: (accountId, file) => {
    const form = new FormData();
    form.append("accountId", accountId);
    form.append("file", file);
    return api.post("/holdings/import/revolut", form).then((r) => r.data);
  },
};

export const ai = {
  status: () => api.get("/ai/status").then((r) => r.data),
  suggest: (ids) => api.post("/ai/suggest", { ids }).then((r) => r.data),
  apply: (changes) => api.post("/ai/apply", { changes }).then((r) => r.data),
  suggestCategories: () => api.post("/ai/categories/suggest").then((r) => r.data),
};

export const goals = {
  list: () => api.get("/goals").then((r) => r.data),
  create: (data) => api.post("/goals", data).then((r) => r.data),
  update: (id, data) => api.put(`/goals/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/goals/${id}`),
};

export const backup = {
  list: () => api.get("/backup").then((r) => r.data),
  create: (data) => api.post("/backup", data).then((r) => r.data),
  update: (id, data) => api.put(`/backup/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/backup/${id}`),
  run: () => api.post("/backup/run").then((r) => r.data),
  downloadUrl: () => `${api.defaults.baseURL}/backup/download`,
  restore: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/backup/restore", form).then((r) => r.data);
  },
};

export const users = {
  list: () => api.get("/users").then((r) => r.data),
  create: (data) => api.post("/users", data).then((r) => r.data),
  update: (id, data) => api.put(`/users/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/users/${id}`),
};

export const config = {
  get: () => api.get("/config").then((r) => r.data),
  update: (data) => api.put("/config", data).then((r) => r.data),
};

export const version = {
  get: () => api.get("/version").then((r) => r.data),
  check: () => api.get("/version/check").then((r) => r.data),
};

export const auth = {
  status: () => api.get("/auth/status").then((r) => r.data),
  setup: (password) => api.post("/auth/setup", { password }).then((r) => r.data),
  login: (password, totpCode) => api.post("/auth/login", { password, totpCode }).then((r) => r.data),
  changePassword: (currentPassword, newPassword) => api.post("/auth/change-password", { currentPassword, newPassword }).then((r) => r.data),
  generate2FA: () => api.post("/auth/2fa/generate").then((r) => r.data),
  enable2FA: (totpCode) => api.post("/auth/2fa/enable", { totpCode }).then((r) => r.data),
  disable2FA: (password) => api.post("/auth/2fa/disable", { password }).then((r) => r.data),
};

export default api;
