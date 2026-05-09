import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAuthenticatedGitUrl,
  createAuthStore,
  getBearerToken,
  normalizeRepoKey,
  redactGitUrl,
} from '../../src/server/auth.js';

describe('server auth helpers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-auth-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('normalizes repository identity by git URL without credentials', () => {
    expect(
      normalizeRepoKey(
        'https://alice:secret@code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket.git',
      ),
    ).toBe('https://code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket');
    expect(normalizeRepoKey('https://code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket/')).toBe(
      'https://code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket',
    );
  });

  it('redacts credentials before URLs are shown in progress or errors', () => {
    expect(redactGitUrl('https://oauth2:token@code.geelib.qihoo.net:11443/tob-ai/repo.git')).toBe(
      'https://code.geelib.qihoo.net:11443/tob-ai/repo.git',
    );
  });

  it('builds an authenticated clone URL from a personal token without changing the repo key', () => {
    const input = 'https://code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket.git';
    const authenticated = buildAuthenticatedGitUrl(input, 'personal-token');

    expect(authenticated).toContain('personal-token');
    expect(normalizeRepoKey(authenticated)).toBe(normalizeRepoKey(input));
  });

  it('stores users, sessions, admin role, and per-repository access in sqlite', async () => {
    const store = await createAuthStore({
      dbPath: path.join(tmpDir, 'auth.sqlite'),
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
      sessionSecret: 'test-secret',
    });

    const user = await store.verifyPassword('admin', 'admin-pass');
    expect(user?.role).toBe('admin');

    const session = await store.createSession(user!.id);
    await store.grantRepoAccess(user!.id, 'https://example.com/org/private.git');

    expect((await store.getSession(session.token))?.username).toBe('admin');
    await expect(
      store.assertRepoAccess(user!.id, 'https://example.com/org/private'),
    ).resolves.toBeUndefined();
    await expect(store.assertRepoAccess(user!.id, 'https://example.com/org/other')).rejects.toThrow(
      /not allowed/,
    );

    await store.close();
  });

  it('extracts bearer tokens from authorization headers', () => {
    expect(getBearerToken('Bearer server-key')).toBe('server-key');
    expect(getBearerToken('Basic abc')).toBeNull();
    expect(getBearerToken(undefined)).toBeNull();
  });
});
