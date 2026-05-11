import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAuthenticatedGitUrl,
  createAuthStore,
  getRequestToken,
  getBearerToken,
  normalizeRepoKey,
  redactGitUrl,
} from '../../src/server/auth.js';
import type pg from 'pg';

class FakePgPool {
  users: any[] = [];
  sessions: any[] = [];
  repoAccess: any[] = [];
  settings: any[] = [];
  invitationCodes: any[] = [];
  auditEvents: any[] = [];
  personalTokens: any[] = [];
  nextId = 1;
  ended = false;

  constructor(private readonly now = new Date('2026-05-10T00:00:00.000Z')) {}

  connect = async () => ({
    query: (text: string, params?: unknown[]) => this.query(text, params),
    release: () => {},
  });

  end = async () => {
    this.ended = true;
  };

  query = async (text: string, params: unknown[] = []): Promise<any> => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (
      normalized.startsWith('CREATE TABLE') ||
      normalized === 'BEGIN' ||
      normalized === 'COMMIT' ||
      normalized === 'ROLLBACK'
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (normalized === 'SELECT id FROM users WHERE username = $1') {
      const rows = this.users.filter((u) => u.username === params[0]).map((u) => ({ id: u.id }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('INSERT INTO users') && normalized.includes('RETURNING')) {
      const row = {
        id: this.nextId++,
        username: params[0],
        password_hash: params[1],
        role: params[2],
        status: 'active',
        created_at: this.now,
      };
      this.users.push(row);
      return { rows: [{ id: row.id, username: row.username, role: row.role }], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO users')) {
      const row = {
        id: this.nextId++,
        username: params[0],
        password_hash: params[1],
        role: params[2],
        status: 'active',
        created_at: this.now,
      };
      this.users.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT id, username, password_hash, role FROM users')) {
      const rows = this.users.filter((u) => u.username === params[0] && u.status === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (normalized === 'SELECT role FROM users WHERE id = $1') {
      const rows = this.users.filter((u) => u.id === params[0]).map((u) => ({ role: u.role }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('INSERT INTO sessions')) {
      this.sessions.push({
        token_hash: params[0],
        user_id: params[1],
        expires_at: new Date(Number(params[2])),
      });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT u.id, u.username, u.role FROM sessions')) {
      const session = this.sessions.find((s) => s.token_hash === params[0]);
      const user = session
        ? this.users.find((u) => u.id === session.user_id && u.status === params[1])
        : null;
      const rows = user ? [{ id: user.id, username: user.username, role: user.role }] : [];
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('DELETE FROM sessions')) {
      this.sessions = this.sessions.filter((s) => s.token_hash !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT id, code_hash FROM invitation_codes')) {
      const rows = this.invitationCodes.filter((i) => i.enabled && !i.used_at);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('UPDATE invitation_codes SET used_by')) {
      const invite = this.invitationCodes.find((i) => i.id === params[1]);
      if (invite) {
        invite.used_by = params[0];
        invite.used_at = this.now;
      }
      return { rows: [], rowCount: invite ? 1 : 0 };
    }
    if (normalized.startsWith('INSERT INTO audit_events')) {
      this.auditEvents.push({
        id: this.nextId++,
        actor_user_id: params[0],
        event_type: params[1],
        metadata: JSON.parse(String(params[2] ?? '{}')),
        created_at: this.now,
      });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO invitation_codes')) {
      const row = {
        id: this.nextId++,
        code_hash: params[0],
        created_by: params[1],
        used_by: null,
        used_at: null,
        enabled: true,
        created_at: this.now,
      };
      this.invitationCodes.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE invitation_codes SET enabled = false')) {
      const invite = this.invitationCodes.find((i) => i.id === Number(params[0]) && !i.used_at);
      if (invite) invite.enabled = false;
      return { rows: [], rowCount: invite ? 1 : 0 };
    }
    if (normalized.startsWith('SELECT id, enabled, used_at')) {
      return { rows: [...this.invitationCodes], rowCount: this.invitationCodes.length };
    }
    if (normalized.startsWith('SELECT id, actor_user_id')) {
      return { rows: [...this.auditEvents], rowCount: this.auditEvents.length };
    }
    if (normalized.startsWith('INSERT INTO personal_tokens')) {
      const row = {
        id: this.nextId++,
        user_id: params[0],
        token_hash: params[1],
        label: params[2],
        created_at: this.now,
        last_used_at: null,
        revoked_at: null,
      };
      this.personalTokens.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT id, label, created_at')) {
      const rows = this.personalTokens.filter((t) => t.user_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('SELECT pt.id, pt.label')) {
      const rows = this.personalTokens.map((t) => {
        const user = this.users.find((u) => u.id === t.user_id);
        return {
          ...t,
          user_id: user?.id,
          username: user?.username,
        };
      });
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('SELECT u.id, u.username, u.role, pt.id AS token_id')) {
      const rows = this.personalTokens
        .filter((t) => !t.revoked_at)
        .map((t) => {
          const user = this.users.find((u) => u.id === t.user_id && u.status === params[0]);
          return user
            ? {
                id: user.id,
                username: user.username,
                role: user.role,
                token_id: t.id,
                token_hash: t.token_hash,
              }
            : null;
        })
        .filter(Boolean);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('UPDATE personal_tokens SET last_used_at')) {
      const token = this.personalTokens.find((t) => t.id === params[0]);
      if (token) token.last_used_at = this.now;
      return { rows: [], rowCount: token ? 1 : 0 };
    }
    if (normalized.startsWith('UPDATE personal_tokens SET revoked_at')) {
      const token = this.personalTokens.find(
        (t) =>
          t.id === Number(params[0]) &&
          !t.revoked_at &&
          (params.length === 1 || t.user_id === params[1]),
      );
      if (token) token.revoked_at = this.now;
      return { rows: [], rowCount: token ? 1 : 0 };
    }
    if (normalized.startsWith('INSERT INTO repo_access')) {
      if (!this.repoAccess.some((r) => r.user_id === params[0] && r.repo_key === params[1])) {
        this.repoAccess.push({ user_id: params[0], repo_key: params[1] });
      }
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT 1 AS ok FROM repo_access')) {
      const rows = this.repoAccess.some((r) => r.user_id === params[0] && r.repo_key === params[1])
        ? [{ ok: 1 }]
        : [];
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('SELECT value FROM settings')) {
      const row = this.settings.find((s) => s.key === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith('INSERT INTO settings')) {
      const existing = this.settings.find((s) => s.key === params[0]);
      if (existing) existing.value = JSON.parse(String(params[1]));
      else this.settings.push({ key: params[0], value: JSON.parse(String(params[1])) });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled fake pg query: ${normalized}`);
  };
}

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

    expect(typeof store.getCapabilities).toBe('function');
    expect(await store.getCapabilities()).toEqual({
      storage: 'sqlite',
      registrationEnabled: false,
      invitationManagementEnabled: false,
      personalTokensEnabled: false,
      auditEnabled: false,
    });
    expect((await store.getSession(session.token))?.username).toBe('admin');
    expect(typeof store.registerUser).toBe('function');
    await expect(
      store.assertRepoAccess(user!.id, 'https://example.com/org/private'),
    ).resolves.toBeUndefined();
    await expect(
      store.assertRepoAccess(user!.id, 'https://example.com/org/other'),
    ).resolves.toBeUndefined();

    await expect(
      store.registerUser({
        username: 'alice',
        password: 'alice-pass',
        invitationCode: 'invite-code',
      }),
    ).rejects.toThrow(/Registration requires PostgreSQL/);
    expect(typeof store.createPersonalToken).toBe('function');
    await expect(store.createPersonalToken(user!.id, 'mcp')).rejects.toThrow(
      /Personal tokens require PostgreSQL/,
    );

    await store.close();
  });

  it('enforces repository access for non-admin users', async () => {
    const store = await createAuthStore({
      dbPath: path.join(tmpDir, 'auth.sqlite'),
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
      sessionSecret: 'test-secret',
    });

    expect(typeof store.createUserForTest).toBe('function');
    const user = await store.createUserForTest('alice', 'alice-pass', 'user');
    await store.grantRepoAccess(user.id, 'https://example.com/org/private.git');

    await expect(
      store.assertRepoAccess(user.id, 'https://example.com/org/private'),
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

  it('extracts request tokens from bearer auth or x-gitnexus-token headers', () => {
    expect(
      getRequestToken({
        authorization: 'Bearer session-token',
        'x-gitnexus-token': 'personal-token',
      }),
    ).toEqual({ token: 'session-token', source: 'authorization' });
    expect(getRequestToken({ 'x-gitnexus-token': 'personal-token' })).toEqual({
      token: 'personal-token',
      source: 'x-gitnexus-token',
    });
    expect(getRequestToken({ authorization: 'Basic abc' })).toBeNull();
  });

  it('uses PostgreSQL mode for invitation registration, audit, and personal tokens', async () => {
    const pool = new FakePgPool();
    const store = await createAuthStore({
      storage: 'postgres',
      pool: pool as unknown as pg.Pool,
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
      sessionSecret: 'test-secret',
    });

    expect(await store.getCapabilities()).toMatchObject({
      storage: 'postgres',
      registrationEnabled: true,
      personalTokensEnabled: true,
    });

    const admin = await store.verifyPassword('admin', 'admin-pass');
    const invitation = await store.createInvitationCode(admin!.id);
    expect(invitation.code).toEqual(expect.any(String));

    const user = await store.registerUser({
      username: 'alice',
      password: 'alice-pass',
      invitationCode: invitation.code!,
    });
    expect(user).toMatchObject({ username: 'alice', role: 'user' });
    await expect(
      store.registerUser({
        username: 'bob',
        password: 'bob-pass',
        invitationCode: invitation.code!,
      }),
    ).rejects.toThrow(/Invalid invitation code/);

    const auditEvents = await store.listAuditEvents();
    expect(auditEvents.map((event) => event.eventType)).toContain('invitation.consumed');

    const createdToken = await store.createPersonalToken(user.id, 'MCP');
    expect(createdToken.token).toMatch(/^gnx_/);
    expect((await store.getPersonalToken(createdToken.token))?.username).toBe('alice');
    expect(await store.listAllPersonalTokens()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdToken.id, username: 'alice', userId: user.id }),
      ]),
    );
    await store.revokePersonalToken(user.id, String(createdToken.id));
    expect(await store.getPersonalToken(createdToken.token)).toBeNull();

    await store.close();
    expect(pool.ended).toBe(true);
  });

  it('rejects disabled PostgreSQL invitation codes', async () => {
    const pool = new FakePgPool();
    const store = await createAuthStore({
      storage: 'postgres',
      pool: pool as unknown as pg.Pool,
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    });
    const admin = await store.verifyPassword('admin', 'admin-pass');
    const invitation = await store.createInvitationCode(admin!.id);

    await store.disableInvitationCode(admin!.id, String(invitation.id));

    await expect(
      store.registerUser({
        username: 'alice',
        password: 'alice-pass',
        invitationCode: invitation.code!,
      }),
    ).rejects.toThrow(/Invalid invitation code/);
    expect((await store.listInvitationCodes())[0].enabled).toBe(false);

    await store.close();
  });

  it('lets PostgreSQL admins revoke user personal tokens', async () => {
    const pool = new FakePgPool();
    const store = await createAuthStore({
      storage: 'postgres',
      pool: pool as unknown as pg.Pool,
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    });
    const admin = await store.verifyPassword('admin', 'admin-pass');
    const user = await store.createUserForTest('alice', 'alice-pass', 'user');
    const createdToken = await store.createPersonalToken(user.id, 'MCP');

    await store.revokeUserPersonalToken(admin!.id, String(createdToken.id));

    expect(await store.getPersonalToken(createdToken.token)).toBeNull();
    expect((await store.listAuditEvents()).map((event) => event.eventType)).toContain(
      'personal_token.admin_revoked',
    );

    await store.close();
  });
});
