import { afterEach, describe, expect, it, vi } from 'vitest';

const importFreshConfig = async () => {
  vi.resetModules();
  return import('../../src/config/ui-constants');
};

describe('backend URL defaults', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the current browser host when VITE_GITNEXUS_BACKEND_URL is not configured', async () => {
    vi.stubEnv('VITE_GITNEXUS_BACKEND_URL', '');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://remote.example.com:4173/'),
    });

    const { getRuntimeBackendUrl } = await importFreshConfig();

    expect(getRuntimeBackendUrl()).toBe('http://remote.example.com:4747');
  });

  it('uses VITE_GITNEXUS_BACKEND_URL when configured', async () => {
    vi.stubEnv('VITE_GITNEXUS_BACKEND_URL', 'https://api.example.com/');

    const { getRuntimeBackendUrl } = await importFreshConfig();

    expect(getRuntimeBackendUrl()).toBe('https://api.example.com');
  });
});
