import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

export const THEMES = [
  { id: "indigo",   label: "Indigo",   colors: ["#6366f1", "#8b5cf6", "#10b981", "#3b82f6"], base: "#0a0a1a" },
  { id: "ocean",    label: "Ocean",    colors: ["#06b6d4", "#0ea5e9", "#14b8a6", "#6366f1"], base: "#020f1a" },
  { id: "emerald",  label: "Emerald",  colors: ["#10b981", "#34d399", "#06b6d4", "#6366f1"], base: "#011a0d" },
  { id: "rose",     label: "Rose",     colors: ["#f43f5e", "#fb7185", "#f97316", "#8b5cf6"], base: "#1a0208" },
  { id: "sunset",   label: "Sunset",   colors: ["#f97316", "#f59e0b", "#ef4444", "#8b5cf6"], base: "#1a0e02" },
  { id: "midnight", label: "Midnight", colors: ["#1e40af", "#4338ca", "#2563eb", "#6366f1"], base: "#020409" },
];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

function applyTheme(themeId, custom) {
  const el = document.documentElement;
  const clearInline = () =>
    ["--c1","--c2","--c3","--c4","--base","--base-dark","--c1-full","--c2-full"].forEach(v => el.style.removeProperty(v));

  if (themeId === "custom" && custom?.c1 && custom?.c2) {
    clearInline();
    el.setAttribute("data-theme", "custom");
    el.style.setProperty("--c1", hexToRgb(custom.c1));
    el.style.setProperty("--c2", hexToRgb(custom.c2));
    el.style.setProperty("--c1-full", custom.c1);
    el.style.setProperty("--c2-full", custom.c2);
    el.style.setProperty("--c3", "16, 185, 129");
    el.style.setProperty("--c4", "59, 130, 246");
    el.style.setProperty("--base", "#0a0a1a");
    el.style.setProperty("--base-dark", "#0d0d2b");
  } else {
    clearInline();
    el.setAttribute("data-theme", themeId || "indigo");
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeRaw] = useState(() => localStorage.getItem("fintrack-theme") || "indigo");
  const [custom, setCustomRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fintrack-theme-custom") || "null"); } catch { return null; }
  });

  useEffect(() => { applyTheme(theme, custom); }, [theme, custom]);

  const setTheme = (id) => {
    setThemeRaw(id);
    localStorage.setItem("fintrack-theme", id);
  };

  const setCustomColors = (colors) => {
    setCustomRaw(colors);
    localStorage.setItem("fintrack-theme-custom", JSON.stringify(colors));
    setThemeRaw("custom");
    localStorage.setItem("fintrack-theme", "custom");
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, custom, setCustomColors, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
