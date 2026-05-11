# PostgreSQL Auth Storage, Invitation Registration, Personal Tokens, and Light Theme

Date: 2026-05-10

## Scope

This design covers four related changes:

- Add PostgreSQL as an optional backend storage provider for multi-user data.
- Add invitation-code registration backed by PostgreSQL.
- Add user-scoped repository visibility and personal tokens for HTTP/MCP access.
- Add a selectable light theme in the web UI.

SQLite remains the default local-development storage mode. When PostgreSQL is disabled, GitNexus keeps the current administrator login and SQLite-backed local mode, and disables registration, invitation management, personal token management, and multi-user repository ownership features.

## Configuration

PostgreSQL is enabled through environment configuration:

- `GITNEXUS_AUTH_STORAGE=postgres` enables the PostgreSQL auth store.
- Any other value, or an unset value, keeps the existing SQLite auth store.
- `GITNEXUS_DATABASE_URL` provides the PostgreSQL connection string.

No real credentials are committed. Documentation and examples use placeholders only.

## Storage Model

The current `AuthStore` interface will be extended rather than replaced. The SQLite implementation stays small and continues to support the current local mode: administrator user, sessions, repository grants, and AI settings.

The PostgreSQL implementation owns the multi-user tables:

- `users`: username, password hash, role, status, timestamps.
- `sessions`: hashed browser session tokens and expiry.
- `repo_access`: user-to-repository grants, with grants created when a user starts analysis or uploads/imports a repository.
- `settings`: administrator-managed AI settings.
- `invitation_codes`: code hash, enabled flag, single-use state, creator, consumer, timestamps.
- `audit_events`: invitation creation, disablement, consumption, token creation, token revocation, and admin actions.
- `personal_tokens`: token hash, user id, label, enabled/revoked state, last-used time, timestamps.

Invitation and personal token plaintext values are shown only at creation time. Stored values are hashed.

## Registration

The web UI gains a registration path beside sign-in. Registration is available only when the backend reports PostgreSQL multi-user mode is enabled.

Registration requires:

- username
- password
- invitation code

The backend validates the invitation code transactionally. A valid enabled unused code creates a normal user, marks the code consumed, and writes an audit event. Invalid, disabled, or already-used codes fail registration without revealing which condition applied.

Administrators can create invitation codes, disable unused codes, and view audit history in the admin UI.

## Permissions

Normal users can see and access only repositories they uploaded, cloned, imported, or were explicitly granted.

Administrators can:

- see all repositories
- configure AI/LLM settings
- manage invitation codes
- view invitation and token audit events
- revoke personal tokens

Existing repository API access checks continue to run through middleware. In PostgreSQL mode, administrators bypass repository ownership checks; normal users must have a matching `repo_access` row.

When `/api/analyze` succeeds for a user-created repository, the backend records repository access for that user. Both remote URL and local path keys are stored when available so later route resolution can match existing registry metadata.

## Personal Tokens and MCP

Users can create personal tokens from the web UI. A token is returned once after creation. The token can be used to authenticate MCP or HTTP requests.

The backend accepts both:

- `Authorization: Bearer <token>`; recommended
- `x-gitnexus-token: <token>`; compatibility fallback

For browser sessions, existing session tokens continue to work. For MCP requests, personal tokens map to a user and apply the same repository visibility rules as browser access. Token usage updates `last_used_at` and emits audit-relevant state where needed.

## API Surface

New or changed backend endpoints:

- `GET /api/auth/capabilities`: returns whether registration, PostgreSQL multi-user mode, invitation management, and personal tokens are enabled.
- `POST /api/auth/register`: creates a user with a valid invitation code.
- `GET /api/admin/invitations`: admin list of invitation codes and status.
- `POST /api/admin/invitations`: admin creates an invitation code.
- `PATCH /api/admin/invitations/:id`: admin disables an invitation code.
- `GET /api/admin/audit-events`: admin audit feed.
- `GET /api/personal-tokens`: current user's personal tokens.
- `POST /api/personal-tokens`: create a personal token.
- `DELETE /api/personal-tokens/:id`: revoke a personal token.

Existing auth endpoints keep their current shapes unless a test proves a compatibility issue.

## Light Theme

The web UI adds a selectable light theme while preserving the current dark theme as default.

Theme implementation uses CSS custom properties and a document-level theme attribute, so existing Tailwind utility names such as `bg-void`, `bg-surface`, `text-text-primary`, and `border-border-subtle` keep working. The theme preference is saved locally in the browser. Theme selection is exposed from the existing UI controls rather than a separate landing page.

The light palette must keep graph and code-inspector readability, avoid low-contrast text, and avoid layout changes when switching themes.

## Testing

Implementation will follow test-first changes.

Backend tests:

- storage factory chooses SQLite by default and PostgreSQL when configured.
- registration is disabled outside PostgreSQL mode.
- PostgreSQL invitation registration consumes a code once and writes audit events.
- disabled or used invitation codes cannot register users.
- normal users see only their own repositories.
- administrators can see all repositories.
- personal tokens authenticate with both supported headers.
- revoked tokens fail authentication.

Frontend tests:

- login page shows registration only when capabilities enable it.
- registration submits username, password, and invitation code.
- theme selection persists and applies the light theme attribute.
- token management calls create/list/revoke endpoints.

Validation commands:

- `cd gitnexus && npm test`
- `cd gitnexus && npx tsc --noEmit`
- `cd gitnexus-web && npm test`
- `cd gitnexus-web && npx tsc -b --noEmit`

## Non-Goals

- No public self-service registration without an invitation code.
- No production credentials or real `.env` values in the repository.
- No role or repository binding inside invitation codes in this iteration.
- No database migration CLI beyond the backend's idempotent schema initialization.
- No visual redesign beyond adding the light theme and required auth/admin/token UI.

## Open Decisions Resolved

- PostgreSQL is optional and toggled via `.env`.
- SQLite remains the default fallback.
- Multi-user registration, invitations, audit, and personal tokens are PostgreSQL-only.
- Invitation codes are stored in PostgreSQL, single-use, disableable, and audited.
- Normal users can only see their own uploaded/imported repositories.
- Administrators can see all repositories and manage invitation, audit, and token revocation workflows.
- MCP token auth supports both `Authorization: Bearer` and `x-gitnexus-token`, with Bearer recommended.
