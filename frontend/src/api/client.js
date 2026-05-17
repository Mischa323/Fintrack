import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

export const accounts = {
  list: () => api.get("/accounts").then((r) => r.data),
  create: (data) => api.post("/accounts", data).then((r) => r.data),
  update: (id, data) => api.put(`/accounts/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/accounts/${id}`),
  recalculate: (id) => api.post(`/accounts/${id}/recalculate`).then((r) => r.data),
};

export const transactions = {
  list: (params) => api.get("/transactions", { params }).then((r) => r.data),
  create: (data) => api.post("/transactions", data).then((r) => r.data),
  update: (id, data) => api.put(`/transactions/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/transactions/${id}`),
};

export const categories = {
  list: () => api.get("/categories").then((r) => r.data),
  create: (data) => api.post("/categories", data).then((r) => r.data),
  update: (id, data) => api.put(`/categories/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/categories/${id}`),
};

export const recurring = {
  list: () => api.get("/recurring").then((r) => r.data),
  create: (data) => api.post("/recurring", data).then((r) => r.data),
  update: (id, data) => api.put(`/recurring/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/recurring/${id}`),
};

export const stats = {
  overview: (params) => api.get("/stats/overview", { params }).then((r) => r.data),
  monthly: () => api.get("/stats/monthly").then((r) => r.data),
};

export const importApi = {
  maybe: (accountId, file) => {
    const form = new FormData();
    form.append("accountId", accountId);
    form.append("file", file);
    return api.post("/import/maybe", form).then((r) => r.data);
  },
  generic: (accountId, file) => {
    const form = new FormData();
    form.append("accountId", accountId);
    form.append("file", file);
    return api.post("/import/generic", form).then((r) => r.data);
  },
};

export default api;
