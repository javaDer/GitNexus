import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBackendUrl,
  getDefaultBackendUrl,
  setAuthToken,
  setBackendUrl,
  startAnalyze,
  fetchRepos,
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
});
