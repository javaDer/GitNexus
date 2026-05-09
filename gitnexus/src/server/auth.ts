import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getGlobalDir } from '../storage/repo-manager.js';
import { normalizeGitUrlForCompare, stripGitUrlCredentials } from './git-clone.js';

const _require = createRequire(import.meta.url);

export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
}

export interface AuthStoreOptions {
  dbPath?: string;
  adminUsername?: string;
  adminPassword?: string;
  sessionSecret?: string;
}

export interface AuthStore {
  verifyPassword(username: string, password: string): Promise<AuthUser | null>;
  createSession(userId: number): Promise<{ token: string; expiresAt: number }>;
  getSession(token: string): Promise<AuthUser | null>;
  deleteSession(token: string): Promise<void>;
  grantRepoAccess(userId: number, repoKey: string): Promise<void>;
  assertRepoAccess(userId: number, repoKey: string): Promise<void>;
  userCanAccessRepo(userId: number, repoKey: string): Promise<boolean>;
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

export const defaultAuthDbPath = (): string =>
  path.join(
    process.env.GITNEXUS_HOME || getGlobalDir() || path.join(os.homedir(), '.gitnexus'),
    'auth.sqlite',
  );

export const createAuthStore = async (options: AuthStoreOptions = {}): Promise<AuthStore> => {
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

    async grantRepoAccess(userId: number, repoKey: string) {
      db.prepare(
        'INSERT OR IGNORE INTO repo_access (user_id, repo_key, created_at) VALUES (?, ?, ?)',
      ).run(userId, normalizeRepoKey(repoKey), Date.now());
    },

    async userCanAccessRepo(userId: number, repoKey: string) {
      const row = db
        .prepare('SELECT 1 AS ok FROM repo_access WHERE user_id = ? AND repo_key = ?')
        .get(userId, normalizeRepoKey(repoKey)) as { ok: number } | undefined;
      return !!row;
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
