import { ref } from "vue";
export type ThemeChoice = "system" | "light" | "dark";
const KEY = "qollab.theme";
function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Storage may be unavailable; follow the system setting. */
  }
  return "system";
}
export const theme = ref<ThemeChoice>(stored());
function apply(value: ThemeChoice) {
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
}
apply(theme.value);
export function setTheme(value: ThemeChoice) {
  theme.value = value;
  apply(value);
  try {
    if (value === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    /* The choice still applies to this page. */
  }
}
/** Small per-viewer layout preferences such as panel widths. */
export function preference<T>(key: string, fallback: T) {
  const value = ref<T>(fallback);
  try {
    const raw = localStorage.getItem("qollab." + key);
    if (raw !== null) value.value = JSON.parse(raw);
  } catch {
    /* Keep the default. */
  }
  return {
    value,
    save(next: T) {
      value.value = next;
      try {
        localStorage.setItem("qollab." + key, JSON.stringify(next));
      } catch {
        /* Keep the value for this page only. */
      }
    },
  };
}
