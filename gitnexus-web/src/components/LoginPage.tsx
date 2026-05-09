import { FormEvent, useState } from 'react';
import { Key, Loader2, Server, User } from '@/lib/lucide-icons';
import { login, normalizeServerUrl, setBackendUrl } from '../services/backend-client';
import { DEFAULT_BACKEND_URL } from '../config/ui-constants';

interface LoginPageProps {
  onLogin: (user: { username: string; role: 'admin' | 'user' }, backendUrl: string, token: string) => void;
}

export const LoginPage = ({ onLogin }: LoginPageProps) => {
  const [serverUrl, setServerUrl] = useState(DEFAULT_BACKEND_URL);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const baseUrl = normalizeServerUrl(serverUrl);
      setBackendUrl(baseUrl);
      const result = await login(username.trim(), password);
      onLogin(result.user, baseUrl, result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border-subtle bg-surface p-6 shadow-2xl"
      >
        <div>
          <h1 className="text-xl font-semibold text-text-primary">GitNexus</h1>
          <p className="mt-1 text-sm text-text-secondary">Sign in to view indexed repositories.</p>
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

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={isLoading || !username.trim() || !password}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
          Sign in
        </button>
      </form>
    </div>
  );
};
