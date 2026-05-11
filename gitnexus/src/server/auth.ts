import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { getGlobalDir } from '../storage/repo-manager.js';
import { normalizeGitUrlForCompare, stripGitUrlCredentials } from './git-clone.js';

const _require = createRequire(import.meta.url);
const { Pool } = pg;

export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
}

export type AuthStorageKind = 'sqlite' | 'postgres';

export interface AuthCapabilities {
  storage: AuthStorageKind;
  registrationEnabled: boolean;
  invitationManagementEnabled: boolean;
  personalTokensEnabled: boolean;
  auditEnabled: boolean;
}

export interface RegisterUserInput {
  username: string;
  password: string;
  invitationCode: string;
}

export interface PersonalToken {
  id: number | string;
  label: string;
  createdAt: number;
  lastUsedAt?: number | null;
  revokedAt?: number | null;
}

export interface CreatedPersonalToken extends PersonalToken {
  token: string;
}

export interface InvitationCode {
  id: number | string;
  code?: string;
  enabled: boolean;
  usedAt?: number | null;
  createdAt: number;
  createdBy?: number | null;
  usedBy?: number | null;
}

export interface AuditEvent {
  id: number | string;
  actorUserId?: number | null;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface AuthStoreOptions {
  dbPath?: string;
  storage?: AuthStorageKind;
  databaseUrl?: string;
  pool?: pg.Pool;
  adminUsername?: string;
  adminPassword?: string;
  sessionSecret?: string;
}

export interface AuthStore {
  getCapabilities(): Promise<AuthCapabilities>;
  verifyPassword(username: string, password: string): Promise<AuthUser | null>;
  registerUser(input: RegisterUserInput): Promise<AuthUser>;
  createUserForTest(username: string, password: string, role: UserRole): Promise<AuthUser>;
  createSession(userId: number): Promise<{ token: string; expiresAt: number }>;
  getSession(token: string): Promise<AuthUser | null>;
  deleteSession(token: string): Promise<void>;
  getPersonalToken(token: string): Promise<AuthUser | null>;
  listPersonalTokens(userId: number): Promise<PersonalToken[]>;
  listAllPersonalTokens(): Promise<Array<PersonalToken & { username: string; userId: number }>>;
  createPersonalToken(userId: number, label: string): Promise<CreatedPersonalToken>;
  revokePersonalToken(userId: number, tokenId: string): Promise<void>;
  revokeUserPersonalToken(actorUserId: number, tokenId: string): Promise<void>;
  listInvitationCodes(): Promise<InvitationCode[]>;
  createInvitationCode(actorUserId: number): Promise<InvitationCode>;
  disableInvitationCode(actorUserId: number, invitationId: string): Promise<void>;
  listAuditEvents(limit?: number): Promise<AuditEvent[]>;
  grantRepoAccess(userId: number, repoKey: string): Promise<void>;
  assertRepoAccess(userId: number, repoKey: string): Promise<void>;
  userCanAccessRepo(userId: number, repoKey: string): Promise<boolean>;
  userCanAccessAnyRepoKey(userId: number, repoKeys: string[]): Promise<boolean>;
  getAiSettings(): Promise<Record<string, unknown>>;
  saveAiSettings(settings: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')): string => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPasswordHash = (password: string, stored: string): boolean => {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
};

const hashSecret = (secret: string, salt = crypto.randomBytes(16).toString('hex')): string => {
  const hash = crypto.createHash('sha256').update(`${salt}:${secret}`).digest('hex');
  return `${salt}:${hash}`;
};

const verifySecretHash = (secret: string, stored: string): boolean => {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.createHash('sha256').update(`${salt}:${secret}`).digest();
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
};

export const normalizeRepoKey = (repoKey: string): string => normalizeGitUrlForCompare(repoKey);

export const redactGitUrl = (url: string): string => {
  return stripGitUrlCredentials(url);
};

export const buildAuthenticatedGitUrl = (
  url: string,
  token?: string,
  serverKey?: string,
): string => {
  const credential = (token || serverKey || '').trim();
  if (!credential) return url;
  const parsed = new URL(url);
  parsed.username = 'oauth2';
  parsed.password = credential;
  return parsed.toString();
};

export const getBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

export type RequestTokenSource = 'authorization' | 'x-gitnexus-token';

export const getRequestToken = (
  headers: Record<string, string | string[] | undefined>,
): { token: string; source: RequestTokenSource } | null => {
  const authorization = headers.authorization;
  const bearer = getBearerToken(Array.isArray(authorization) ? authorization[0] : authorization);
  if (bearer) return { token: bearer, source: 'authorization' };

  const header = headers['x-gitnexus-token'];
  const value = Array.isArray(header) ? header[0] : header;
  const token = value?.trim();
  return token ? { token, source: 'x-gitnexus-token' } : null;
};

export const defaultAuthDbPath = (): string =>
  path.join(
    process.env.GITNEXUS_HOME || getGlobalDir() || path.join(os.homedir(), '.gitnexus'),
    'auth.sqlite',
  );

export const createAuthStore = async (options: AuthStoreOptions = {}): Promise<AuthStore> => {
  const storage = options.storage ?? (process.env.GITNEXUS_AUTH_STORAGE as AuthStorageKind);
  if (storage === 'postgres') {
    return createPostgresAuthStore(options);
  }

  const dbPath = options.dbPath ?? defaultAuthDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const { DatabaseSync } = _require('node:sqlite') as { DatabaseSync: any };
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS repo_access (
      user_id INTEGER NOT NULL,
      repo_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, repo_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const adminUsername = options.adminUsername ?? process.env.GITNEXUS_ADMIN_USERNAME ?? 'admin';
  const adminPassword = options.adminPassword ?? process.env.GITNEXUS_ADMIN_PASSWORD ?? 'admin';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername) as
    | { id: number }
    | undefined;
  if (!existing) {
    db.prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
    ).run(adminUsername, hashPassword(adminPassword), 'admin', Date.now());
  }

  const tokenHash = (token: string): string =>
    crypto
      .createHmac(
        'sha256',
        options.sessionSecret ??
          process.env.GITNEXUS_SESSION_SECRET ??
          'gitnexus-dev-session-secret',
      )
      .update(token)
      .digest('hex');

  return {
    async getCapabilities() {
      return {
        storage: 'sqlite',
        registrationEnabled: false,
        invitationManagementEnabled: false,
        personalTokensEnabled: false,
        auditEnabled: false,
      };
    },

    async verifyPassword(username: string, password: string) {
      const row = db
        .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
        .get(username) as
        | {
            id: number;
            username: string;
            password_hash: string;
            role: UserRole;
          }
        | undefined;
      if (!row || !verifyPasswordHash(password, row.password_hash)) return null;
      return { id: row.id, username: row.username, role: row.role };
    },

    async registerUser() {
      throw new Error('Registration requires PostgreSQL auth storage');
    },

    async createUserForTest(username: string, password: string, role: UserRole) {
      const now = Date.now();
      db.prepare(
        'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
      ).run(username, hashPassword(password), role, now);
      const row = db
        .prepare('SELECT id, username, role FROM users WHERE username = ?')
        .get(username) as AuthUser;
      return row;
    },

    async createSession(userId: number) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_TTL_MS;
      db.prepare(
        'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      ).run(tokenHash(token), userId, expiresAt, Date.now());
      return { token, expiresAt };
    },

    async getSession(token: string) {
      const row = db
        .prepare(
          `SELECT u.id, u.username, u.role
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(tokenHash(token), Date.now()) as AuthUser | undefined;
      return row ?? null;
    },

    async deleteSession(token: string) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    },

    async getPersonalToken() {
      return null;
    },

    async listPersonalTokens() {
      return [];
    },

    async listAllPersonalTokens() {
      return [];
    },

    async createPersonalToken() {
      throw new Error('Personal tokens require PostgreSQL auth storage');
    },

    async revokePersonalToken() {
      throw new Error('Personal tokens require PostgreSQL auth storage');
    },

    async revokeUserPersonalToken() {
      throw new Error('Personal tokens require PostgreSQL auth storage');
    },

    async listInvitationCodes() {
      return [];
    },

    async createInvitationCode() {
      throw new Error('Invitation codes require PostgreSQL auth storage');
    },

    async disableInvitationCode() {
      throw new Error('Invitation codes require PostgreSQL auth storage');
    },

    async listAuditEvents() {
      return [];
    },

    async grantRepoAccess(userId: number, repoKey: string) {
      db.prepare(
        'INSERT OR IGNORE INTO repo_access (user_id, repo_key, created_at) VALUES (?, ?, ?)',
      ).run(userId, normalizeRepoKey(repoKey), Date.now());
    },

    async userCanAccessRepo(userId: number, repoKey: string) {
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as
        | { role: UserRole }
        | undefined;
      if (user?.role === 'admin') return true;
      const row = db
        .prepare('SELECT 1 AS ok FROM repo_access WHERE user_id = ? AND repo_key = ?')
        .get(userId, normalizeRepoKey(repoKey)) as { ok: number } | undefined;
      return !!row;
    },

    async userCanAccessAnyRepoKey(userId: number, repoKeys: string[]) {
      for (const repoKey of repoKeys) {
        if (await this.userCanAccessRepo(userId, repoKey)) return true;
      }
      return false;
    },

    async assertRepoAccess(userId: number, repoKey: string) {
      if (!(await this.userCanAccessRepo(userId, repoKey))) {
        throw new Error('User is not allowed to access this repository');
      }
    },

    async getAiSettings() {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai') as
        | { value: string }
        | undefined;
      return row ? JSON.parse(row.value) : {};
    },

    async saveAiSettings(settings: Record<string, unknown>) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
        'ai',
        JSON.stringify(settings),
        Date.now(),
      );
    },

    async close() {
      db.close();
    },
  };
};

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return Date.now();
};

const mapPersonalToken = (row: any): PersonalToken => ({
  id: row.id,
  label: row.label,
  createdAt: toMillis(row.created_at),
  lastUsedAt: row.last_used_at ? toMillis(row.last_used_at) : null,
  revokedAt: row.revoked_at ? toMillis(row.revoked_at) : null,
});

const mapInvitationCode = (row: any, code?: string): InvitationCode => ({
  id: row.id,
  code,
  enabled: !!row.enabled,
  usedAt: row.used_at ? toMillis(row.used_at) : null,
  createdAt: toMillis(row.created_at),
  createdBy: row.created_by ?? null,
  usedBy: row.used_by ?? null,
});

const mapAuditEvent = (row: any): AuditEvent => ({
  id: row.id,
  actorUserId: row.actor_user_id ?? null,
  eventType: row.event_type,
  metadata:
    typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata ?? {}),
  createdAt: toMillis(row.created_at),
});

const createPostgresAuthStore = async (options: AuthStoreOptions): Promise<AuthStore> => {
  const pool =
    options.pool ??
    new Pool({
      connectionString: options.databaseUrl ?? process.env.GITNEXUS_DATABASE_URL,
    });

  const query = (text: string, params: unknown[] = []) => pool.query(text, params);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS repo_access (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      repo_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, repo_key)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invitation_codes (
      id BIGSERIAL PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      used_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS personal_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const adminUsername = options.adminUsername ?? process.env.GITNEXUS_ADMIN_USERNAME ?? 'admin';
  const adminPassword = options.adminPassword ?? process.env.GITNEXUS_ADMIN_PASSWORD ?? 'admin';
  const existingAdmin = await query('SELECT id FROM users WHERE username = $1', [adminUsername]);
  if (existingAdmin.rowCount === 0) {
    await query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [
      adminUsername,
      hashPassword(adminPassword),
      'admin',
    ]);
  }

  const tokenHash = (token: string): string =>
    crypto
      .createHmac(
        'sha256',
        options.sessionSecret ??
          process.env.GITNEXUS_SESSION_SECRET ??
          'gitnexus-dev-session-secret',
      )
      .update(token)
      .digest('hex');

  const writeAudit = async (
    actorUserId: number | null,
    eventType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> => {
    await query(
      'INSERT INTO audit_events (actor_user_id, event_type, metadata) VALUES ($1, $2, $3)',
      [actorUserId, eventType, JSON.stringify(metadata)],
    );
  };

  return {
    async getCapabilities() {
      return {
        storage: 'postgres',
        registrationEnabled: true,
        invitationManagementEnabled: true,
        personalTokensEnabled: true,
        auditEnabled: true,
      };
    },

    async verifyPassword(username: string, password: string) {
      const result = await query(
        'SELECT id, username, password_hash, role FROM users WHERE username = $1 AND status = $2',
        [username, 'active'],
      );
      const row = result.rows[0];
      if (!row || !verifyPasswordHash(password, row.password_hash)) return null;
      return { id: Number(row.id), username: row.username, role: row.role };
    },

    async registerUser(input: RegisterUserInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const invites = await client.query(
          `SELECT id, code_hash
           FROM invitation_codes
           WHERE enabled = true AND used_at IS NULL
           FOR UPDATE`,
        );
        const invite = invites.rows.find((row: any) =>
          verifySecretHash(input.invitationCode, row.code_hash),
        );
        if (!invite) throw new Error('Invalid invitation code');

        const created = await client.query(
          'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
          [input.username, hashPassword(input.password), 'user'],
        );
        const user = created.rows[0];
        await client.query(
          'UPDATE invitation_codes SET used_by = $1, used_at = now() WHERE id = $2',
          [user.id, invite.id],
        );
        await client.query(
          'INSERT INTO audit_events (actor_user_id, event_type, metadata) VALUES ($1, $2, $3)',
          [user.id, 'invitation.consumed', JSON.stringify({ invitationId: invite.id })],
        );
        await client.query('COMMIT');
        return { id: Number(user.id), username: user.username, role: user.role };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async createUserForTest(username: string, password: string, role: UserRole) {
      const result = await query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
        [username, hashPassword(password), role],
      );
      const row = result.rows[0];
      return { id: Number(row.id), username: row.username, role: row.role };
    },

    async createSession(userId: number) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_TTL_MS;
      await query(
        'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))',
        [tokenHash(token), userId, expiresAt],
      );
      return { token, expiresAt };
    },

    async getSession(token: string) {
      const result = await query(
        `SELECT u.id, u.username, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = $2`,
        [tokenHash(token), 'active'],
      );
      const row = result.rows[0];
      return row ? { id: Number(row.id), username: row.username, role: row.role } : null;
    },

    async deleteSession(token: string) {
      await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
    },

    async getPersonalToken(token: string) {
      const result = await query(
        `SELECT u.id, u.username, u.role, pt.id AS token_id, pt.token_hash
         FROM personal_tokens pt
         JOIN users u ON u.id = pt.user_id
         WHERE pt.revoked_at IS NULL AND u.status = $1`,
        ['active'],
      );
      const row = result.rows.find((candidate: any) =>
        verifySecretHash(token, candidate.token_hash),
      );
      if (!row) return null;
      await query('UPDATE personal_tokens SET last_used_at = now() WHERE id = $1', [row.token_id]);
      return { id: Number(row.id), username: row.username, role: row.role };
    },

    async listPersonalTokens(userId: number) {
      const result = await query(
        'SELECT id, label, created_at, last_used_at, revoked_at FROM personal_tokens WHERE user_id = $1 ORDER BY created_at DESC',
        [userId],
      );
      return result.rows.map(mapPersonalToken);
    },

    async listAllPersonalTokens() {
      const result = await query(
        `SELECT pt.id, pt.label, pt.created_at, pt.last_used_at, pt.revoked_at, u.id AS user_id, u.username
         FROM personal_tokens pt
         JOIN users u ON u.id = pt.user_id
         ORDER BY pt.created_at DESC`,
      );
      return result.rows.map((row: any) => ({
        ...mapPersonalToken(row),
        userId: Number(row.user_id),
        username: row.username,
      }));
    },

    async createPersonalToken(userId: number, label: string) {
      const token = `gnx_${crypto.randomBytes(32).toString('base64url')}`;
      const result = await query(
        'INSERT INTO personal_tokens (user_id, token_hash, label) VALUES ($1, $2, $3) RETURNING id, label, created_at, last_used_at, revoked_at',
        [userId, hashSecret(token), label],
      );
      await writeAudit(userId, 'personal_token.created', { label });
      return { ...mapPersonalToken(result.rows[0]), token };
    },

    async revokePersonalToken(userId: number, tokenId: string) {
      await query(
        'UPDATE personal_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
        [tokenId, userId],
      );
      await writeAudit(userId, 'personal_token.revoked', { tokenId });
    },

    async revokeUserPersonalToken(actorUserId: number, tokenId: string) {
      await query(
        'UPDATE personal_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
        [tokenId],
      );
      await writeAudit(actorUserId, 'personal_token.admin_revoked', { tokenId });
    },

    async listInvitationCodes() {
      const result = await query(
        'SELECT id, enabled, used_at, created_at, created_by, used_by FROM invitation_codes ORDER BY created_at DESC',
      );
      return result.rows.map((row: any) => mapInvitationCode(row));
    },

    async createInvitationCode(actorUserId: number) {
      const code = crypto.randomBytes(18).toString('base64url');
      const result = await query(
        'INSERT INTO invitation_codes (code_hash, created_by) VALUES ($1, $2) RETURNING id, enabled, used_at, created_at, created_by, used_by',
        [hashSecret(code), actorUserId],
      );
      await writeAudit(actorUserId, 'invitation.created', { invitationId: result.rows[0].id });
      return mapInvitationCode(result.rows[0], code);
    },

    async disableInvitationCode(actorUserId: number, invitationId: string) {
      await query('UPDATE invitation_codes SET enabled = false WHERE id = $1 AND used_at IS NULL', [
        invitationId,
      ]);
      await writeAudit(actorUserId, 'invitation.disabled', { invitationId });
    },

    async listAuditEvents(limit = 100) {
      const result = await query(
        'SELECT id, actor_user_id, event_type, metadata, created_at FROM audit_events ORDER BY created_at DESC LIMIT $1',
        [Math.max(1, Math.min(500, Math.trunc(limit)))],
      );
      return result.rows.map(mapAuditEvent);
    },

    async grantRepoAccess(userId: number, repoKey: string) {
      await query(
        'INSERT INTO repo_access (user_id, repo_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, normalizeRepoKey(repoKey)],
      );
    },

    async userCanAccessRepo(userId: number, repoKey: string) {
      const user = await query('SELECT role FROM users WHERE id = $1', [userId]);
      if (user.rows[0]?.role === 'admin') return true;
      const result = await query(
        'SELECT 1 AS ok FROM repo_access WHERE user_id = $1 AND repo_key = $2',
        [userId, normalizeRepoKey(repoKey)],
      );
      return result.rowCount > 0;
    },

    async userCanAccessAnyRepoKey(userId: number, repoKeys: string[]) {
      for (const repoKey of repoKeys) {
        if (await this.userCanAccessRepo(userId, repoKey)) return true;
      }
      return false;
    },

    async assertRepoAccess(userId: number, repoKey: string) {
      if (!(await this.userCanAccessRepo(userId, repoKey))) {
        throw new Error('User is not allowed to access this repository');
      }
    },

    async getAiSettings() {
      const result = await query('SELECT value FROM settings WHERE key = $1', ['ai']);
      return result.rows[0]?.value ?? {};
    },

    async saveAiSettings(settings: Record<string, unknown>) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        ['ai', JSON.stringify(settings)],
      );
    },

    async close() {
      await pool.end();
    },
  };
};
