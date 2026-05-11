import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultBackendUrl,
  setAuthToken,
  setBackendUrl,
  startAnalyze,
  fetchRepos,
  fetchAuthCapabilities,
  register,
  createPersonalToken,
  fetchAdminPersonalTokens,
  fetchPersonalTokens,
  revokePersonalToken,
  revokeAdminPersonalToken,
  createInvitation,
  fetchInvitations,
  disableInvitation,
  fetchAuditEvents,
  streamAnalyzeProgress,
} from '../../src/services/backend-client';
import { isAdminUser } from '../../src/services/auth-client';

afterEach(() => {
  vi.restoreAllMocks();
  setAuthToken(null);
  setBackendUrl(getDefaultBackendUrl());
});

describe('backend environment and auth client behavior', () => {
  it('initializes the backend URL from Vite env instead of hard-coded localhost', () => {
    expect(getDefaultBackendUrl()).toBe('https://backend.example.test');
  });

  it('adds authorization headers to API requests when logged in', async () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchRepos();

    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example.test/api/repos');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toBeInstanceOf(Headers);
    expect(
      ((fetchMock.mock.calls[0][1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer session-token');
  });

  it('passes private clone credentials to the analyze API without placing them in the URL', async () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobId: 'job-1', status: 'queued' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await startAnalyze({
      url: 'https://code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket.git',
      gitToken: 'clone-token',
      serverKey: 'server-key',
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example.test/api/analyze');
    expect(body.url).toBe('https://code.geelib.qihoo.net:11443/tob-ai/openclaw-websocket.git');
    expect(body.gitToken).toBe('clone-token');
    expect(body.serverKey).toBe('server-key');
  });

  it('adds authorization headers to SSE progress streams', async () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 401,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = streamAnalyzeProgress('job-1', vi.fn(), vi.fn(), vi.fn());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://backend.example.test/api/analyze/job-1/progress',
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer session-token',
    });
  });

  it('recognizes admin users for AI Settings gating', () => {
    expect(isAdminUser({ username: 'admin', role: 'admin' })).toBe(true);
    expect(isAdminUser({ username: 'user', role: 'user' })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
  });

  it('fetches auth capabilities', async () => {
    setBackendUrl('https://backend.example.test');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ storage: 'postgres', registrationEnabled: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAuthCapabilities()).resolves.toMatchObject({
      storage: 'postgres',
      registrationEnabled: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example.test/api/auth/capabilities');
  });

  it('submits registration with an invitation code and stores the returned session token', async () => {
    setBackendUrl('https://backend.example.test');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'new-session',
          expiresAt: 1,
          user: { username: 'alice', role: 'user' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await register('alice', 'secret', 'invite-123');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example.test/api/auth/register');
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'alice',
      password: 'secret',
      invitationCode: 'invite-123',
    });
    expect(init.method).toBe('POST');
  });

  it('calls personal token endpoints', async () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tokens: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, label: 'MCP', token: 'gnx_secret' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPersonalTokens();
    await createPersonalToken('MCP');
    await revokePersonalToken('1');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://backend.example.test/api/personal-tokens',
      'https://backend.example.test/api/personal-tokens',
      'https://backend.example.test/api/personal-tokens/1',
    ]);
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('DELETE');
  });

  it('calls admin invitation and audit endpoints', async () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invitations: [], events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 7, code: 'invite', enabled: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await fetchInvitations();
    await createInvitation();
    await disableInvitation('7');
    await fetchAuditEvents();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://backend.example.test/api/admin/invitations',
      'https://backend.example.test/api/admin/invitations',
      'https://backend.example.test/api/admin/invitations/7',
      'https://backend.example.test/api/admin/audit-events',
    ]);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('PATCH');
  });

  it('calls admin personal token endpoints', async () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tokens: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchAdminPersonalTokens();
    await revokeAdminPersonalToken('9');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://backend.example.test/api/admin/personal-tokens',
      'https://backend.example.test/api/admin/personal-tokens/9',
    ]);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
  });
});
