// Visual theme (dark/light). The choice is stored in localStorage
// and applied as a data-theme attribute on <html>; the CSS tokens
// in index.css read it. Dark is the default. This stores only a UI
// preference, no wallet data.

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'nux_theme';

const THEME_COLORS: Record<Theme, string> = {
  dark: '#021702',
  light: '#f6f8f7',
};

export function getStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  // Keep the browser chrome (and the installed PWA's status bar)
  // in sync with the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the theme still
    // applies for this session.
  }
}
