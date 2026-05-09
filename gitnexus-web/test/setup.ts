import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

const ensureStorage = (name: 'localStorage' | 'sessionStorage') => {
  const current = globalThis[name] as Storage | undefined;
  if (current && typeof current.removeItem === 'function') return;
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, String(value)),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
    },
  });
};

// Reset storage between tests
beforeEach(() => {
  ensureStorage('localStorage');
  ensureStorage('sessionStorage');
  sessionStorage.removeItem('gitnexus-llm-settings');
  sessionStorage.removeItem('gitnexus-auth-token');
  sessionStorage.removeItem('gitnexus-auth-user');
  localStorage.removeItem('gitnexus-llm-settings'); // legacy key (migration)
});
