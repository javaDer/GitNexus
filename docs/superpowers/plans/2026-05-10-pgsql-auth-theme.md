# PostgreSQL Auth Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL-backed multi-user auth, invitation-code registration, personal tokens for HTTP/MCP access, per-user repository isolation, and a selectable light theme.

**Architecture:** Keep the existing SQLite auth store as the default local mode and add a PostgreSQL auth store behind the existing `AuthStore` boundary. Extend auth middleware so browser session tokens and personal tokens resolve to the same user identity, then reuse repository access checks for HTTP API and MCP. Add frontend capability discovery, registration/token/admin controls, and theme tokens without redesigning the existing UI.

**Tech Stack:** Node.js 22, TypeScript, Express, `pg`, `node:sqlite`, Vitest, React 19, Vite, Tailwind CSS v4.

---

## Files

- Modify: `gitnexus/package.json`
- Modify: `gitnexus/package-lock.json`
- Modify: `gitnexus/src/server/auth.ts`
- Modify: `gitnexus/src/server/api.ts`
- Modify: `gitnexus/src/server/mcp-http.ts`
- Modify: `gitnexus/src/mcp/local/local-backend.ts`
- Modify: `gitnexus/test/unit/auth.test.ts`
- Create: `gitnexus/test/unit/mcp-authz.test.ts`
- Modify: `gitnexus/test/unit/rate-limit.test.ts`
- Modify: `gitnexus-web/src/services/backend-client.ts`
- Modify: `gitnexus-web/src/services/auth-client.ts`
- Modify: `gitnexus-web/src/components/LoginPage.tsx`
- Create: `gitnexus-web/src/components/PersonalTokensPanel.tsx`
- Create: `gitnexus-web/src/components/AdminAccessPanel.tsx`
- Create: `gitnexus-web/src/theme.ts`
- Modify: `gitnexus-web/src/App.tsx`
- Modify: `gitnexus-web/src/components/Header.tsx`
- Modify: `gitnexus-web/src/lib/lucide-icons.tsx`
- Modify: `gitnexus-web/src/index.css`
- Modify: `gitnexus-web/test/unit/backend-env-auth.test.ts`
- Create: `gitnexus-web/test/unit/theme.test.ts`
- Create: `gitnexus-web/test/unit/login-register.test.tsx`

## Tasks

### Task 1: Backend Auth Store Contract and SQLite Fallback

**Files:**
- Modify: `gitnexus/src/server/auth.ts`
- Modify: `gitnexus/test/unit/auth.test.ts`

- [ ] Write failing tests for capabilities, disabled registration, personal token header extraction, and admin repository bypass in SQLite mode.
- [ ] Run `cd gitnexus && npx vitest run test/unit/auth.test.ts`.
- [ ] Extend `AuthStore` with capabilities, registration, invitation, audit, personal token, and admin-aware repo access methods.
- [ ] Keep SQLite local mode behavior and return disabled multi-user capabilities.
- [ ] Run `cd gitnexus && npx vitest run test/unit/auth.test.ts`.

### Task 2: PostgreSQL Auth Store

**Files:**
- Modify: `gitnexus/package.json`
- Modify: `gitnexus/package-lock.json`
- Modify: `gitnexus/src/server/auth.ts`
- Modify: `gitnexus/test/unit/auth.test.ts`

- [ ] Add `pg` dependency and `@types/pg` development dependency.
- [ ] Write failing tests using a fake pg pool for storage selection, invitation consumption, disabled/used invitation rejection, audit events, personal token creation, and revoked token rejection.
- [ ] Run `cd gitnexus && npx vitest run test/unit/auth.test.ts`.
- [ ] Implement PostgreSQL schema initialization and store methods using parameterized queries and transactions for registration.
- [ ] Store invitation and personal token values as hashes only.
- [ ] Run `cd gitnexus && npx vitest run test/unit/auth.test.ts`.

### Task 3: HTTP API Registration, Admin, Personal Tokens, and Repository Isolation

**Files:**
- Modify: `gitnexus/src/server/api.ts`
- Modify: `gitnexus/test/unit/rate-limit.test.ts`

- [ ] Write structural API tests for new capability/register/admin/token routes and personal-token-aware auth helper exports.
- [ ] Run `cd gitnexus && npx vitest run test/unit/rate-limit.test.ts`.
- [ ] Add `/api/auth/capabilities`, `/api/auth/register`, admin invitation/audit routes, and personal token routes.
- [ ] Update auth middleware to resolve browser sessions and personal tokens, accepting `Authorization: Bearer` and `x-gitnexus-token`.
- [ ] Update repo listing and access checks so admins see all repos and normal users require grants.
- [ ] Run `cd gitnexus && npx vitest run test/unit/rate-limit.test.ts`.

### Task 4: MCP Personal Token Authorization

**Files:**
- Modify: `gitnexus/src/server/mcp-http.ts`
- Modify: `gitnexus/src/mcp/local/local-backend.ts`
- Create: `gitnexus/test/unit/mcp-authz.test.ts`

- [ ] Write failing tests proving `LocalBackend.withRepoAccessFilter` filters `listRepos`, denies unauthorized explicit repo access, and lets admins bypass.
- [ ] Run `cd gitnexus && npx vitest run test/unit/mcp-authz.test.ts`.
- [ ] Add an optional repository access filter to `LocalBackend`, preserving default behavior for CLI/stdio usage.
- [ ] Require authenticated users for HTTP MCP when auth store requires it, and pass a per-user filtered backend into `createMCPServer`.
- [ ] Run `cd gitnexus && npx vitest run test/unit/mcp-authz.test.ts`.

### Task 5: Frontend Auth Client, Registration, Token, and Admin APIs

**Files:**
- Modify: `gitnexus-web/src/services/backend-client.ts`
- Modify: `gitnexus-web/src/services/auth-client.ts`
- Modify: `gitnexus-web/test/unit/backend-env-auth.test.ts`

- [ ] Write failing client tests for capabilities fetch, registration request body, personal token endpoints, admin invitation endpoints, and auth headers.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/backend-env-auth.test.ts`.
- [ ] Add typed client methods and shared types for auth capabilities, registration, invitation admin, audit events, and personal tokens.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/backend-env-auth.test.ts`.

### Task 6: Frontend Theme System

**Files:**
- Create: `gitnexus-web/src/theme.ts`
- Modify: `gitnexus-web/src/index.css`
- Modify: `gitnexus-web/src/App.tsx`
- Modify: `gitnexus-web/src/components/Header.tsx`
- Modify: `gitnexus-web/src/lib/lucide-icons.tsx`
- Create: `gitnexus-web/test/unit/theme.test.ts`

- [ ] Write failing tests for theme load/save/apply and default dark theme.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/theme.test.ts`.
- [ ] Implement `theme.ts` helpers and light token overrides under `[data-theme='light']`.
- [ ] Add a compact theme toggle in the header.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/theme.test.ts`.

### Task 7: Frontend Registration and Management UI

**Files:**
- Modify: `gitnexus-web/src/components/LoginPage.tsx`
- Create: `gitnexus-web/src/components/PersonalTokensPanel.tsx`
- Create: `gitnexus-web/src/components/AdminAccessPanel.tsx`
- Modify: `gitnexus-web/src/components/SettingsPanel.tsx`
- Create: `gitnexus-web/test/unit/login-register.test.tsx`

- [ ] Write failing UI tests for registration availability, invitation-code submission, token creation display-once, token revocation, and admin invitation creation.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/login-register.test.tsx`.
- [ ] Add login/register mode switching and invitation-code field when capabilities enable registration.
- [ ] Add token management and admin access panels inside settings.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/login-register.test.tsx`.

### Task 8: Final Verification and Review

**Files:**
- All modified files

- [ ] Run `cd gitnexus && npx vitest run test/unit/auth.test.ts test/unit/rate-limit.test.ts test/unit/mcp-authz.test.ts`.
- [ ] Run `cd gitnexus && npm test`.
- [ ] Run `cd gitnexus && npx tsc --noEmit`.
- [ ] Run `cd gitnexus-web && npx vitest run test/unit/backend-env-auth.test.ts test/unit/theme.test.ts test/unit/login-register.test.tsx`.
- [ ] Run `cd gitnexus-web && npm test`.
- [ ] Run `cd gitnexus-web && npx tsc -b --noEmit`.
- [ ] Run GitNexus impact/detect changes checks where tool availability allows.
- [ ] Inspect `git diff --stat` and `git diff` for unrelated edits or secrets.
