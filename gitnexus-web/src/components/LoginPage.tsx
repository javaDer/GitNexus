import { FormEvent, useEffect, useState } from 'react';
import { Key, Loader2, Server, Ticket, User } from '@/lib/lucide-icons';
import {
  fetchAuthCapabilities,
  login,
  normalizeServerUrl,
  register,
  setBackendUrl,
  type AuthCapabilities,
} from '../services/backend-client';
import { DEFAULT_BACKEND_URL } from '../config/ui-constants';

interface LoginPageProps {
  onLogin: (
    user: { username: string; role: 'admin' | 'user' },
    backendUrl: string,
    token: string,
  ) => void;
}

export const LoginPage = ({ onLogin }: LoginPageProps) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serverUrl, setServerUrl] = useState(DEFAULT_BACKEND_URL);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      const baseUrl = normalizeServerUrl(serverUrl);
      setBackendUrl(baseUrl);
      fetchAuthCapabilities()
        .then((nextCapabilities) => {
          if (!cancelled) setCapabilities(nextCapabilities);
        })
        .catch(() => {
          if (!cancelled) setCapabilities(null);
        });
    } catch {
      setCapabilities(null);
    }
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const baseUrl = normalizeServerUrl(serverUrl);
      setBackendUrl(baseUrl);
      const trimmedUsername = username.trim();
      const result =
        mode === 'register'
          ? await register(trimmedUsername, password, invitationCode.trim())
          : await login(trimmedUsername, password);
      onLogin(result.user, baseUrl, result.token);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === 'register'
            ? 'Registration failed'
            : 'Login failed',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const registrationEnabled = capabilities?.registrationEnabled === true;
  const canSubmit =
    !isLoading &&
    username.trim().length > 0 &&
    password.length > 0 &&
    (mode === 'login' || invitationCode.trim().length > 0);

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border-subtle bg-surface p-6 shadow-2xl"
      >
        <div>
          <h1 className="text-xl font-semibold text-text-primary">GitNexus</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {mode === 'register'
              ? 'Create an account with an invitation code.'
              : 'Sign in to view indexed repositories.'}
          </p>
        </div>

        <label className="block space-y-2">
          <span className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Server className="h-4 w-4" />
            Backend URL
          </span>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-elevated px-4 py-3 font-mono text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="block space-y-2">
          <span className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <User className="h-4 w-4" />
            Username
          </span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-elevated px-4 py-3 text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="block space-y-2">
          <span className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Key className="h-4 w-4" />
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-elevated px-4 py-3 text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        {mode === 'register' && (
          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-text-secondary">
              <Ticket className="h-4 w-4" />
              Invitation Code
            </span>
            <input
              type="text"
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value)}
              className="w-full rounded-xl border border-border-subtle bg-elevated px-4 py-3 font-mono text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
        )}

        {mode === 'register' && capabilities && !registrationEnabled && (
          <p className="text-sm text-text-muted">
            User registration is available only when PostgreSQL storage is enabled.
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode((current) => (current === 'login' ? 'register' : 'login'));
            setError(null);
          }}
          disabled={mode === 'login' && capabilities !== null && !registrationEnabled}
          className="w-full rounded-xl border border-border-subtle px-4 py-2.5 text-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === 'register' ? 'Back to sign in' : 'Create an account'}
        </button>
      </form>
    </div>
  );
};
