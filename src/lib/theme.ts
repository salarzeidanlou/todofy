export type Theme = "dark" | "light";

const KEY = "todofy-theme";

export function initialTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || "dark";
}

/** Apply a theme to the document and persist it. Dark is the default,
 * so it needs no attribute; light is opt-in via `data-theme`. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  localStorage.setItem(KEY, theme);
}
