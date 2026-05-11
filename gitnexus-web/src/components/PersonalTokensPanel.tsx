import { useEffect, useState } from 'react';
import { AlertCircle, Key, Loader2, Trash2 } from '@/lib/lucide-icons';
import {
  createPersonalToken,
  fetchPersonalTokens,
  revokePersonalToken,
  type CreatedPersonalToken,
  type PersonalTokenInfo,
  type AuthCapabilities,
} from '../services/backend-client';

interface PersonalTokensPanelProps {
  capabilities: AuthCapabilities | null;
}

export const PersonalTokensPanel = ({ capabilities }: PersonalTokensPanelProps) => {
  const [tokens, setTokens] = useState<PersonalTokenInfo[]>([]);
  const [label, setLabel] = useState('MCP');
  const [created, setCreated] = useState<CreatedPersonalToken | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = async () => {
    if (!capabilities?.personalTokensEnabled) return;
    setTokens(await fetchPersonalTokens());
  };

  useEffect(() => {
    void refresh().catch(() => setTokens([]));
  }, [capabilities?.personalTokensEnabled]);

  if (!capabilities?.personalTokensEnabled) {
    return (
      <section className="space-y-3 border-t border-border-subtle pt-5">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-text-muted" />
          <h3 className="text-sm font-semibold text-text-primary">Personal Tokens</h3>
        </div>
        <p className="text-sm text-text-secondary">
          Personal tokens are available only when PostgreSQL storage is enabled.
        </p>
      </section>
    );
  }

  const handleCreate = async () => {
    setIsLoading(true);
    try {
      const token = await createPersonalToken(label.trim() || 'MCP');
      setCreated(token);
      await refresh();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-border-subtle pt-5">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Personal Tokens</h3>
      </div>
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        />
        <button
          onClick={handleCreate}
          disabled={isLoading}
          className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
        </button>
      </div>
      {created?.token && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 font-mono text-xs text-text-primary">
          {created.token}
        </div>
      )}
      <div className="space-y-2">
        {tokens.map((token) => (
          <div
            key={String(token.id)}
            className="flex items-center justify-between rounded-lg border border-border-subtle bg-elevated px-3 py-2"
          >
            <span className="truncate text-sm text-text-secondary">{token.label}</span>
            <button
              onClick={async () => {
                await revokePersonalToken(String(token.id));
                await refresh();
              }}
              className="rounded p-1 text-text-muted hover:bg-hover hover:text-red-400"
              title="Revoke token"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
