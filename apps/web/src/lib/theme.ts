export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'pesly-theme';

/** Anything outside the two known values (tampered, missing or the legacy `system`) means "unset". */
export function parseTheme(value: unknown): Theme | null {
  return THEMES.find((theme) => theme === value) ?? null;
}

/** With no stored choice the interface follows the operating system. */
export function resolveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? 'dark' : 'light');
}

/**
 * Runs before first paint so the page never flashes the wrong theme. It must stay a constant
 * string: it is rendered inline under the CSP nonce, so nothing variable may enter it (R-01).
 * Keep the key and the rules in sync with `THEME_STORAGE_KEY` and `resolveTheme`.
 */
export const THEME_SCRIPT =
  '(function(){var d=false;try{var t=null;try{t=localStorage.getItem("pesly-theme")}catch(e){}d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)}catch(e){}document.documentElement.classList.toggle("dark",d)})()';
