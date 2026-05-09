import type { UserRole } from './backend-client';

export interface CurrentUser {
  username: string;
  role: UserRole;
}

export const AUTH_TOKEN_KEY = 'gitnexus-auth-token';

export const isAdminUser = (user: CurrentUser | null): boolean => user?.role === 'admin';

