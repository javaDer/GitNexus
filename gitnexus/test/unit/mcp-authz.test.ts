import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lbugMocks } = vi.hoisted(() => ({
  lbugMocks: {
    initLbug: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([]),
    executeParameterized: vi.fn().mockResolvedValue([]),
    closeLbug: vi.fn().mockResolvedValue(undefined),
    isLbugReady: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('@ladybugdb/core', () => ({
  default: {
    Database: vi.fn(),
    Connection: vi.fn(),
  },
}));

vi.mock('../../src/core/lbug/pool-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/lbug/pool-adapter.js')>();
  return { ...actual, ...lbugMocks };
});

vi.mock('../../src/mcp/core/lbug-adapter.js', () => lbugMocks);

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn().mockResolvedValue([]),
  cleanupOldKuzuFiles: vi.fn().mockResolvedValue({ found: false, needsReindex: false }),
}));

vi.mock('../../src/core/git-staleness.js', () => ({
  checkStalenessAsync: vi.fn().mockResolvedValue({ isStale: false, commitsBehind: 0 }),
  checkCwdMatch: vi.fn().mockResolvedValue({ match: 'none' }),
}));

import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import { listRegisteredRepos } from '../../src/storage/repo-manager.js';

const repos = [
  {
    name: 'alpha',
    path: '/tmp/alpha',
    storagePath: '/tmp/alpha/.gitnexus',
    indexedAt: '2026-05-10T00:00:00.000Z',
    lastCommit: 'a',
    remoteUrl: 'https://example.com/org/alpha.git',
    stats: {},
  },
  {
    name: 'beta',
    path: '/tmp/beta',
    storagePath: '/tmp/beta/.gitnexus',
    indexedAt: '2026-05-10T00:00:00.000Z',
    lastCommit: 'b',
    remoteUrl: 'https://example.com/org/beta.git',
    stats: {},
  },
];

describe('LocalBackend repository authorization filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRegisteredRepos).mockResolvedValue(repos as any);
  });

  it('filters list_repos to authorized repositories', async () => {
    const backend = new LocalBackend({
      canAccessRepo: async ({ remoteUrl }) => remoteUrl?.includes('/alpha.git') ?? false,
    });

    await backend.init();

    expect((await backend.listRepos()).map((repo) => repo.name)).toEqual(['alpha']);
  });

  it('denies explicit access to unauthorized repositories', async () => {
    const backend = new LocalBackend({
      canAccessRepo: async ({ remoteUrl }) => remoteUrl?.includes('/alpha.git') ?? false,
    });

    await backend.init();

    await expect(backend.resolveRepo('beta')).rejects.toThrow(/not found/);
  });

  it('preserves unrestricted behavior when no filter is supplied', async () => {
    const backend = new LocalBackend();

    await backend.init();

    expect((await backend.listRepos()).map((repo) => repo.name).sort()).toEqual(['alpha', 'beta']);
  });
});
