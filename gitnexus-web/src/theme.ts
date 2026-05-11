export type AppTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'gitnexus-theme';

const isTheme = (value: string | null): value is AppTheme => value === 'dark' || value === 'light';

export const getStoredTheme = (): AppTheme | null => {
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(value) ? value : null;
};

export const setStoredTheme = (theme: AppTheme): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export const loadTheme = (): AppTheme => getStoredTheme() ?? 'dark';

export const applyTheme = (theme: AppTheme): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
};

export const toggleTheme = (theme: AppTheme): AppTheme => (theme === 'dark' ? 'light' : 'dark');
