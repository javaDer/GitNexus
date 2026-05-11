import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../../src/components/LoginPage';
import {
  getDefaultBackendUrl,
  setAuthToken,
  setBackendUrl,
} from '../../src/services/backend-client';

afterEach(() => {
  vi.restoreAllMocks();
  setAuthToken(null);
  setBackendUrl(getDefaultBackendUrl());
});

describe('LoginPage registration flow', () => {
  it('registers with an invitation code when PostgreSQL registration is enabled', async () => {
    const onLogin = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            storage: 'postgres',
            registrationEnabled: true,
            invitationManagementEnabled: true,
            personalTokensEnabled: true,
            auditEnabled: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: 'session-token',
            expiresAt: 1,
            user: { username: 'alice', role: 'user' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage onLogin={onLogin} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText(/Invitation Code/i), {
      target: { value: 'invite-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith(
        { username: 'alice', role: 'user' },
        'https://backend.example.test',
        'session-token',
      ),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      username: 'alice',
      password: 'secret',
      invitationCode: 'invite-123',
    });
  });

  it('keeps account creation disabled when registration is not available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          storage: 'sqlite',
          registrationEnabled: false,
          invitationManagementEnabled: false,
          personalTokensEnabled: false,
          auditEnabled: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage onLogin={vi.fn()} />);

    const createButton = await screen.findByRole('button', { name: 'Create an account' });
    expect(createButton).toBeDisabled();
  });
});
