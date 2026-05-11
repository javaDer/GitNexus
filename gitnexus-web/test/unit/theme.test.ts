import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  getStoredTheme,
  loadTheme,
  setStoredTheme,
  toggleTheme,
  type AppTheme,
} from '../../src/theme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme helpers', () => {
  it('defaults to dark when no preference is stored', () => {
    expect(loadTheme()).toBe('dark');
  });

  it('persists and applies a light theme', () => {
    setStoredTheme('light');
    expect(getStoredTheme()).toBe<AppTheme>('light');

    applyTheme(loadTheme());

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggles between dark and light themes', () => {
    expect(toggleTheme('dark')).toBe('light');
    expect(toggleTheme('light')).toBe('dark');
  });
});
