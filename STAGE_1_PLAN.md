# Shop Inventory — Stage 1 Implementation Plan

**Stage:** Cloud-first MVP foundation  
**Repository:** `ryfo-agents/shop-inventory`  
**Decision:** The MVP is server-authoritative and online-first. Local-first inventory persistence, offline edits, client sync queues, and conflict merging are out of scope for Stage 1.

## Stage 1 objective

Replace the current personal/local-first architecture with a dependable private cloud application where:

- users authenticate;
- every request is authorized against a workspace;
- checklist content and audit marks are stored in Postgres;
- the browser reads and writes through the API;
- the app has a clear loading, saving, error, and session-expired state;
- deployment, migrations, tests, backups, and rollback are repeatable.

The stage is complete when the owner can use the shop inventory app from multiple browsers and trust that the server is the source of truth.

## Product boundary

### Included

- Private account sign-in and sign-out.
- One default workspace per user.
- Server-backed checklist sections, subsections, and items.
- Server-backed audit marks: status, quantity, specification, note, and cost.
- Checklist editing: add, rename, reorder, soft-delete, and restore where practical.
- Buy-list generation from server data.
- Search, filters, section navigation, and settings.
- JSON/CSV/Markdown export from server-authorized data.
- Database migrations, backups, health checks, and rollback documentation.
- Responsive browser UI.

### Not included

- Offline inventory edits.
- IndexedDB as an authoritative data store.
- Client-side sync queues or last-write-wins merging.
- Real-time collaboration or WebSockets.
- Billing, teams, public signup, barcode scanning, retailer integrations, or AI.
- Native mobile applications.

A service worker may cache static assets for faster repeat loads, but it must not imply that inventory edits are safely available offline. If the browser loses connectivity during a write, the UI must report failure rather than pretend the change was saved.

## Target architecture

```text
Browser UI
  ├─ authenticated session cookie
  ├─ server-fetched checklist/query state
  ├─ explicit loading/saving/error states
  └─ optional static-asset cache only
        │ HTTPS
        ▼
Vercel serverless API
  ├─ authentication
  ├─ workspace authorization
  ├─ checklist CRUD
  ├─ marks CRUD
  ├─ buy-list query
  ├─ export endpoints
  └─ health endpoint
        │
        ▼
Neon/Postgres
  ├─ users
  ├─ workspaces
  ├─ memberships
  ├─ sections
  ├─ subsections
  ├─ items
  ├─ marks
  └─ audit events
```

### Recommended implementation approach

Do not rewrite the entire frontend before proving the cloud model. First separate the existing code into stable boundaries while preserving the current UI:

1. Keep the current hand-rendered UI temporarily.
2. Remove IndexedDB/localStorage as the source of truth for inventory state.
3. Add an API client module for authenticated reads and writes.
4. Replace direct state mutation with request → server response → render.
5. Refactor into framework/components only if the resulting code remains difficult to maintain after Stage 1.

This reduces the risk of simultaneously changing product behavior, persistence, and presentation.

## Step-by-step execution plan

### Step 1 — Freeze the current baseline

**Actions**

- Create a `stage-1-cloud-first` branch.
- Record the current commit and production deployment.
- Run `npm ci` and `npm test`.
- Capture the current checklist count, section count, and key user flows.
- Export a JSON/CSV/Markdown backup of the current checklist and marks.
- Label the current IndexedDB/localStorage implementation as legacy migration code.

**Acceptance criteria**

- The current app can be restored from the recorded commit.
- A known backup exists before persistence changes begin.
- The test command and current warnings are documented.

### Step 2 — Establish migrations and environment contracts

**Actions**

- Replace the one-off `db/schema.sql` setup with numbered migrations.
- Add a migration command that records applied migrations.
- Add `.env.example` containing variable names only.
- Define separate development, preview, and production database environments.
- Add a safe seed command for the factory checklist.
- Add a database connection health check.
- Document migration, rollback, and seed procedures.

**Initial environment variables**

- `DATABASE_URL`
- `SESSION_SECRET`
- Authentication provider configuration or password-reset configuration
- `APP_ORIGIN`
- `CRON_SECRET` only if scheduled jobs are introduced

**Acceptance criteria**

- A blank database can be migrated from zero with one documented command.
- A migration can be applied in preview without touching production.
- No secret value exists in Git, test fixtures, or documentation.

### Step 3 — Add the ownership model

**Actions**

Create:

- `users`
  - `id`, `email`, `display_name`, `created_at`, `updated_at`, `disabled_at`
- `workspaces`
  - `id`, `name`, `owner_id`, `created_at`, `updated_at`, `archived_at`
- `memberships`
  - `workspace_id`, `user_id`, `role`, `created_at`, `revoked_at`
- `audit_events`
  - `id`, `workspace_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `created_at`, `metadata`

Add `workspace_id` to sections, subsections, items, and marks. Keep item IDs immutable.

Add database constraints for:

- valid roles;
- valid mark statuses;
- non-negative quantities and costs;
- unique membership per workspace/user;
- valid foreign-key ownership;
- soft-delete consistency.

**Acceptance criteria**

- Every inventory row belongs to exactly one workspace.
- Every API query can be scoped by workspace.
- A user cannot access another workspace by changing an ID in a request.

### Step 4 — Replace shared passphrase access

**Current implementation:** Stage 1 uses email plus a minimum 12-character password, scrypt password hashing, secure HttpOnly session cookies, and in-memory login/register rate limiting. Passwordless email or a hosted identity provider can replace this later without changing the workspace API.

- Add sign-in and sign-out screens.
- Create or locate the user after verified authentication.
- Create a default workspace on first login.
- Issue secure, HttpOnly, same-site session cookies.
- Add session expiry and revocation.
- Add a current-user endpoint.
- Return generic authentication failures.
- Remove the shared passphrase from the normal production path.
- Keep a temporary migration-only mechanism, if needed, behind a disabled-by-default flag.

**Acceptance criteria**

- A new user can sign in and receives one workspace.
- A signed-out request cannot read or write inventory data.
- A revoked or expired session cannot access the API.
- No API route trusts a client-provided user or workspace ID.

### Step 5 — Build the server-authoritative API

Implement these endpoints, all protected by authentication and workspace authorization:

```text
GET    /api/me
GET    /api/workspaces
GET    /api/workspaces/:workspaceId/checklist
POST   /api/workspaces/:workspaceId/sections
PATCH  /api/workspaces/:workspaceId/sections/:id
DELETE /api/workspaces/:workspaceId/sections/:id
POST   /api/workspaces/:workspaceId/subsections
PATCH  /api/workspaces/:workspaceId/subsections/:id
DELETE /api/workspaces/:workspaceId/subsections/:id
POST   /api/workspaces/:workspaceId/items
PATCH  /api/workspaces/:workspaceId/items/:id
DELETE /api/workspaces/:workspaceId/items/:id
GET    /api/workspaces/:workspaceId/marks
PUT    /api/workspaces/:workspaceId/marks/:itemId
GET    /api/workspaces/:workspaceId/buy-list
GET    /api/workspaces/:workspaceId/export/:format
GET    /api/health
```

**API rules**

- Use explicit request and response schemas.
- Validate IDs, statuses, numbers, strings, arrays, and pagination parameters.
- Enforce a maximum request body and maximum batch size.
- Return consistent error objects with a request ID.
- Use transactions for related checklist mutations.
- Return the persisted server row after every write.
- Treat `PUT` mark updates as idempotent.
- Use soft-delete for user-visible entities.
- Record important mutations in `audit_events`.

**Acceptance criteria**

- All inventory reads come from the API.
- All inventory writes are confirmed by a successful server response.
- A failed request leaves the UI in an explicitly unsaved or unchanged state.
- Unauthorized, malformed, oversized, and cross-workspace requests are rejected.

### Step 6 — Replace client persistence with request state

**Actions**

- Remove inventory records from IndexedDB/localStorage persistence.
- Keep only non-authoritative preferences locally: theme, UI expansion, and last-view preference.
- Add an API client with:
  - credentials included;
  - JSON parsing;
  - request ID handling;
  - timeout/abort behavior;
  - session-expired handling;
  - normalized error handling.
- Add page-level loading states.
- Add mutation-level saving indicators.
- Disable or queue UI controls while a mutation is pending.
- Re-fetch or update from the server response after writes.
- Show a clear “not saved” error when a request fails.

**Acceptance criteria**

- Opening the app in a second browser shows server data without importing local state.
- Refreshing the page does not lose a successful edit.
- Closing the browser during a failed request does not create a false saved state.
- Clearing browser storage does not delete server inventory.

### Step 7 — Rework the core user flows

Implement and verify in this order:

1. Login.
2. Load index and checklist.
3. Open a section.
4. Mark an item.
5. Edit quantity/spec/note/cost.
6. Add, rename, reorder, and soft-delete an item.
7. Build the buy list.
8. Export data.
9. Sign out and sign back in.
10. Repeat from a second browser.

Remove or rewrite UI language that implies offline operation, local-only storage, or background sync. Replace it with:

- “Saved”;
- “Saving…”;
- “Unable to save”;
- “Sign in to continue.”

**Acceptance criteria**

- The primary audit workflow works on a phone-sized viewport.
- Every mutation has visible success/failure feedback.
- The buy list reflects persisted marks after refresh.
- Server data survives browser storage deletion.

### Step 8 — Add production test coverage

Add tests at three levels.

#### Unit tests

- auth/session verification;
- workspace authorization;
- request validation;
- status and buy-list calculations;
- soft-delete behavior;
- item-ID stability;
- migration helpers.

#### API integration tests

- create a user/workspace;
- read checklist;
- update a mark;
- update checklist content;
- reject unauthorized access;
- reject cross-workspace access;
- reject malformed and oversized payloads;
- verify transaction rollback;
- verify audit events.

#### Browser tests

- login/logout;
- mobile audit flow;
- failed-save recovery;
- refresh after mutation;
- second-browser visibility;
- export;
- session expiration;
- keyboard navigation and accessible names.

**Acceptance criteria**

- CI runs all tests on every pull request.
- Production API behavior is covered without depending on a personal database.
- The browser suite catches a failed-save or auth regression.

### Step 9 — Add deployment and operations gates

**Actions**

- Add GitHub Actions.
- Require CI before merging to `main`.
- Add preview deployments for pull requests.
- Apply migrations in a controlled deployment step.
- Add a production health check.
- Add error monitoring with sensitive data scrubbing.
- Configure database backups.
- Perform a clean restore drill.
- Document rollback for both application code and migrations.
- Add uptime monitoring.

**Acceptance criteria**

- A broken pull request cannot merge.
- A production deployment can be rolled back.
- A database can be restored into a clean environment.
- An API failure produces a diagnosable event.

### Step 10 — Private beta gate

Before calling Stage 1 complete:

- Use the app for at least one complete shop audit.
- Use it from two browsers or devices.
- Delete browser storage and verify server data remains.
- Test a failed network request and confirm the UI does not claim success.
- Test session expiry and re-authentication.
- Export the workspace and restore it in a non-production environment.
- Verify no secrets, local database URLs, or personal inventory data are present in Git.
- Review the audit log for representative mutations.

## Definition of done

Stage 1 is complete when:

- Postgres is the only authoritative inventory store.
- Authentication and workspace authorization are enforced on every data route.
- Shared passphrase access is removed from normal production use.
- The app works reliably online from multiple browsers.
- Every write reports an explicit persisted or failed state.
- Checklist editing and marks survive refresh, sign-out, and browser-storage deletion.
- API validation, integration tests, browser tests, CI, backups, and rollback documentation exist.
- A clean restore drill succeeds.
- A private beta user can complete a real audit without developer intervention.

## First implementation batch

Start with these five tickets, in order:

1. **Cloud-first architecture branch and baseline backup**
2. **Numbered database migrations plus workspace ownership schema**
3. **Authenticated `/api/me` and workspace authorization middleware**
4. **Server-authoritative checklist read endpoint**
5. **Server-authoritative mark update endpoint and first browser integration test**

Do not remove the old client persistence code until the read path and one complete write path are working against the real database. Remove it immediately after the server-authoritative path passes the two-browser acceptance test.
