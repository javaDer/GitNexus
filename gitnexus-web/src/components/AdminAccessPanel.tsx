import { useEffect, useState } from 'react';
import { Loader2, Ticket, Trash2 } from '@/lib/lucide-icons';
import {
  createInvitation,
  disableInvitation,
  fetchAuditEvents,
  fetchAdminPersonalTokens,
  fetchInvitations,
  revokeAdminPersonalToken,
  type AuditEventInfo,
  type AuthCapabilities,
  type InvitationCodeInfo,
  type PersonalTokenInfo,
} from '../services/backend-client';

interface AdminAccessPanelProps {
  capabilities: AuthCapabilities | null;
}

export const AdminAccessPanel = ({ capabilities }: AdminAccessPanelProps) => {
  const [invitations, setInvitations] = useState<InvitationCodeInfo[]>([]);
  const [events, setEvents] = useState<AuditEventInfo[]>([]);
  const [tokens, setTokens] = useState<PersonalTokenInfo[]>([]);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const refresh = async () => {
    if (!capabilities?.invitationManagementEnabled) return;
    const [nextInvitations, nextEvents, nextTokens] = await Promise.all([
      fetchInvitations(),
      fetchAuditEvents(),
      fetchAdminPersonalTokens(),
    ]);
    setInvitations(nextInvitations);
    setEvents(nextEvents);
    setTokens(nextTokens);
  };

  useEffect(() => {
    void refresh().catch(() => {});
  }, [capabilities?.invitationManagementEnabled]);

  if (!capabilities?.invitationManagementEnabled) {
    return null;
  }

  return (
    <section className="space-y-3 border-t border-border-subtle pt-5">
      <div className="flex items-center gap-2">
        <Ticket className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Access Management</h3>
      </div>
      <button
        onClick={async () => {
          setIsCreating(true);
          try {
            const invitation = await createInvitation();
            setCreatedCode(invitation.code ?? null);
            await refresh();
          } finally {
            setIsCreating(false);
          }
        }}
        disabled={isCreating}
        className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create invitation'}
      </button>
      {createdCode && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 font-mono text-xs text-text-primary">
          {createdCode}
        </div>
      )}
      <div className="max-h-36 space-y-2 overflow-y-auto">
        {invitations.map((invitation) => (
          <div
            key={String(invitation.id)}
            className="flex items-center justify-between rounded-lg border border-border-subtle bg-elevated px-3 py-2"
          >
            <span className="text-sm text-text-secondary">
              #{invitation.id} {invitation.enabled ? 'active' : 'disabled'}
            </span>
            {invitation.enabled && !invitation.usedAt && (
              <button
                onClick={async () => {
                  await disableInvitation(String(invitation.id));
                  await refresh();
                }}
                className="rounded p-1 text-text-muted hover:bg-hover hover:text-red-400"
                title="Disable invitation"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="max-h-36 space-y-2 overflow-y-auto">
        {tokens.map((token) => (
          <div
            key={String(token.id)}
            className="flex items-center justify-between rounded-lg border border-border-subtle bg-elevated px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm text-text-secondary">
              {token.username ?? `user-${token.userId}`} / {token.label}
              {token.revokedAt ? ' (revoked)' : ''}
            </span>
            {!token.revokedAt && (
              <button
                onClick={async () => {
                  await revokeAdminPersonalToken(String(token.id));
                  await refresh();
                }}
                className="rounded p-1 text-text-muted hover:bg-hover hover:text-red-400"
                title="Revoke user token"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="max-h-28 space-y-1 overflow-y-auto text-xs text-text-muted">
        {events.slice(0, 5).map((event) => (
          <div key={String(event.id)}>{event.eventType}</div>
        ))}
      </div>
    </section>
  );
};
