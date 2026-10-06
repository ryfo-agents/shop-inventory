# Shop Inventory: MVP Production Roadmap

**Repository:** `ryfo-agents/shop-inventory`  
**Assessment date:** October 6, 2026  
**Current production shape:** static PWA on Vercel with an optional Neon/Postgres sync backend

## Executive recommendation

Turn this into a **private, multi-device household/workshop inventory product first**, not a general SaaS marketplace or full warehouse-management system.

The existing product already has a strong wedge:

> Walk through a physical shop, audit what is present, identify gaps, build a buy list, and keep the result usable offline.

The MVP should optimize for one household or small workshop owner who needs a dependable audit tool on a phone, tablet, and laptop. Keep the local-first PWA experience, but make the backend, authentication, data model, recovery, observability, and deployment trustworthy enough for real production use.

Do not start with billing, teams, barcode integrations, vendor APIs, or a framework rewrite. Those are post-MVP options after actual usage proves the need.

## Repository assessment

### What exists today

- A 1,534-item garage-shop checklist parsed from `data/checklist.md`.
- A mobile-oriented static PWA with service-worker caching.
- Offline/local-first audit state stored in IndexedDB with a localStorage fallback.
- Statuses for have, missing, upgrade, blocking, N/A, and unaudited.
- Quantity, restock-target, specification, note, and cost fields.
- Section filters, search, buy-list generation, store grouping, cost totals, exports, theme controls, and wake-lock support.
- In-app checklist editing: add, rename, reorder, soft-delete, and undo.
- Optional cross-device sync through Vercel serverless functions and Neon/Postgres.
- A 45-check jsdom smoke suite.
- A plain static frontend with no build step or frontend framework.

### Current strengths

- The core workflow is coherent and differentiated.
- Offline behavior is a correct choice for a garage or workshop.
- The checklist has unusually rich domain-specific metadata.
- Item IDs are now frozen rather than recomputed after renames.
- Deletes are represented as tombstones, which is necessary for sync.
- Last-write-wins is enforced in SQL rather than only in browser code.
- The app has exports and undo, both valuable for trust.
- The static frontend remains cheap and simple to deploy.

### Current risks and gaps

1. **Authentication is shared-passphrase access, not product identity.** Anyone with the passphrase is the same user; there is no account ownership, invitation, revocation, per-device management, or audit trail.
2. **Sync is not yet production-hardened.** `POST /api/sync` accepts client-provided arrays with no visible payload limits, schema validation, rate limiting, idempotency key, audit log, or conflict observability.
3. **Database writes are many independent requests.** `lib/db.js` performs row-by-row upserts without a transaction. A partial sync can leave related data temporarily incomplete.
4. **The data model is tightly coupled to the original checklist.** Sections, subsections, and items are sufficient for the current shop, but there is no explicit workspace/household, location, inventory snapshot, audit session, attachment, or purchase state model.
5. **The app lacks a formal deployment pipeline.** There is no CI workflow, linting, type checking, migration runner, preview-environment gate, or branch protection.
6. **The test suite is valuable but narrow.** It exercises the DOM and offline behavior; it does not test deployed APIs, database migrations, auth boundaries, two-device conflict cases, service-worker update behavior, accessibility, or mobile browsers.
7. **The service worker creates release risk.** `sw.js` is cache-first and requires a cache-version bump when shell files change. This should be automated or redesigned.
8. **The frontend is a large hand-rolled file.** `app.js` contains parsing, state, persistence, sync, routing, rendering, editor behavior, and exports. It is workable now but will become difficult to change safely.
9. **The product boundary is not explicit.** The repository currently mixes the personal checklist, generic app behavior, backend, and deployment concerns.
10. **No documented recovery path exists.** Exports exist, but there is no scheduled database backup verification, restore drill, account recovery, or data-retention policy.

## Product definition for MVP

### Target user

A workshop owner or household operator who maintains a physical shop, garage, studio, or equipment room and needs to know:

- What do I own?
- What is missing or unsafe?
- What needs replenishing?
- What should I buy before the next project?
- Can I trust this data from my phone while offline?

### MVP promise

> Audit a real-world inventory offline, sync it safely across devices, and turn gaps into an actionable buy list.

### Must-have MVP capabilities

- Private sign-in and sign-out.
- One default workspace with a clear path to multiple workspaces later.
- Offline audit and local persistence.
- Cross-device sync with conflict handling that is understandable to the user.
- Stable item identity across rename, reorder, and soft-delete.
- Checklist editing with undo and recovery.
- Buy list with quantity, target, cost, store, and purchased state.
- Search, filters, section navigation, and mobile-friendly controls.
- JSON, CSV, and Markdown export.
- Import/restore from a validated backup file.
- Account/session revocation.
- Database backup and tested restore procedure.
- Error reporting, health checks, and basic usage telemetry that does not leak inventory contents.

### Explicitly out of scope for MVP

- Barcode scanning and OCR.
- Supplier or retailer integrations.
- Automatic price scraping.
- Shared real-time collaboration.
- Billing and subscriptions.
- Public marketplace or multi-tenant administration.
- Native iOS/Android apps.
- Complex warehouse features such as bins, serial-number tracking, receiving, or fulfillment.
- AI-generated inventory recommendations.

## Decisions to make now

| Decision | Recommendation | Why |
|---|---|---|
| Product shape | Private household/workshop app | Matches current value and avoids premature SaaS complexity |
| Frontend | Keep the PWA for MVP | Offline behavior and current UX are assets; rewrite risk is high |
| Hosting | Keep Vercel for frontend/API initially | Fits current deployment and serverless API shape |
| Database | Keep Neon/Postgres initially | Existing schema and driver work; relational model fits the domain |
| Auth | Replace shared passphrase before calling it production | Per-user identity and revocation are required for durable ownership |
| Sync | Keep bidirectional sync, add validation/versioning/transactions | Preserves local-first behavior without accepting fragile payloads |
| Data scope | One workspace in UI, workspace-aware schema underneath | Avoids a forced migration when sharing or multiple shops arrive |
| Deployment | GitHub source of truth plus CI and manual production approval | Fits current Vercel constraints and reduces accidental releases |
| Monetization | None in MVP | Prove repeat use before adding billing |

## Target architecture

```text
PWA client
  ├─ IndexedDB local store
  ├─ service worker and offline shell
  ├─ sync queue / cursor
  └─ accessible UI
        │ HTTPS JSON API
        ▼
Vercel Functions
  ├─ auth/session middleware
  ├─ validated sync endpoint
  ├─ checklist CRUD endpoints
  ├─ export/import endpoints
  ├─ health endpoint
  └─ optional scheduled backup/maintenance endpoint
        │ pooled/serverless Postgres connection
        ▼
Neon Postgres
  ├─ users
  ├─ workspaces
  ├─ memberships
  ├─ sections/subsections/items
  ├─ marks and purchase state
  ├─ sync changes or version metadata
  ├─ audit events
  └─ migration metadata

External services
  ├─ transactional email for recovery/invitations, if needed
  ├─ error monitoring
  └─ object storage only when attachments are added
```

Vercel Functions are adequate for the current API size, but sync payloads should be bounded because Vercel documents a 4.5 MB request/response body limit for Functions. Neon’s serverless driver is appropriate for serverless access; use pooled connections where connection pressure becomes relevant.

## Data model evolution

### Phase 1 schema changes

Add these before production launch:

- `users`
  - `id`, `email`, `name`, `created_at`, `updated_at`, `disabled_at`
- `workspaces`
  - `id`, `name`, `owner_id`, `created_at`, `updated_at`, `archived_at`
- `memberships`
  - `workspace_id`, `user_id`, `role`, `created_at`, `revoked_at`
- `workspace_id` on all checklist and mark tables.
- `version` or monotonic revision field on mutable rows.
- `deleted_at` and `deleted_by` in addition to a boolean where useful.
- `audit_events`
  - actor, workspace, entity, action, timestamp, request/device metadata.
- `sync_cursors` or a workspace change-log table if cursor-based sync needs reliable deletion/change history.
- `schema_migrations` managed by a repeatable migration command.

### Preserve these invariants

- Item IDs are immutable.
- Client timestamps are not trusted as authoritative ordering without server validation.
- A deleted row remains sync-visible until every supported client can receive the tombstone.
- Foreign-key creation order is preserved.
- Every mutation is attributable to a user and workspace.
- Server-side authorization checks workspace membership on every read and write.

## Roadmap

### Phase 0 — Product and operational baseline

**Goal:** Define the product boundary and make the current app reproducible.

- Write a one-page product brief and acceptance criteria.
- Record the canonical user journeys:
  - first open offline;
  - audit an item;
  - build a buy list;
  - edit the checklist;
  - sign in on a second device;
  - recover from a bad edit;
  - export and restore data.
- Add `.env.example` with names only, never secrets.
- Document local development, deployment, migrations, rollback, and restore.
- Add a `CHANGELOG.md` and release/version convention.
- Decide the production hostname and data owner.

**Exit criteria:** a new developer can run the app, run tests, understand the data model, and deploy a preview without secret values.

### Phase 1 — CI and quality gates

**Goal:** Stop regressions before production.

- Add GitHub Actions for:
  - `npm ci`;
  - smoke tests;
  - syntax checks;
  - dependency audit;
  - API unit tests;
  - migration verification.
- Add branch protection for `main`.
- Add a deploy checklist requiring a passing CI run.
- Add Playwright or equivalent browser tests for mobile viewport flows.
- Add a11y checks for keyboard access, labels, focus order, contrast, and screen-reader names.
- Make jsdom test output clean by stubbing unsupported browser methods such as `window.scrollTo` and suppressing expected navigation warnings.
- Add a service-worker cache-version check so shell changes cannot ship without an intentional cache update.

**Exit criteria:** pull requests fail on test, syntax, migration, or accessibility regressions.

### Phase 2 — Backend hardening

**Goal:** Make the existing sync backend safe enough for real private use.

- Validate every request with explicit schemas.
- Reject unknown fields, invalid IDs, invalid timestamps, oversized arrays, and oversized strings.
- Add body-size and row-count limits.
- Add rate limiting to login and sync.
- Add login attempt logging without recording passphrases or inventory contents.
- Use generic auth failure responses.
- Add CSRF protection if cookie-authenticated state-changing endpoints remain same-origin and browser-accessible.
- Add a transaction or server-side batch strategy for related sync writes.
- Return structured sync errors and a retryable/non-retryable classification.
- Add idempotency keys for sync batches.
- Add API health/readiness endpoints that do not expose configuration.
- Add unit tests for expired, malformed, forged, missing-secret, and unauthorized requests.
- Add database constraints for valid statuses, non-negative quantities/costs, and valid roles.

**Exit criteria:** the API rejects malformed and unauthorized traffic predictably, and a failed sync cannot silently corrupt or partially overwrite newer data.

### Phase 3 — Identity and workspace ownership

**Goal:** Replace the shared passphrase with durable ownership.

Recommended MVP path:

- Add passwordless email magic links or a hosted identity provider.
- Create a user on first verified login.
- Create one default workspace automatically.
- Add invite-only membership later if a second household member is needed.
- Add session listing/revocation in Settings.
- Add account export and account deletion procedures.
- Keep the existing local-first mode available before sign-in.

Do not expose the app publicly with only one shared passphrase. It is acceptable as a temporary private deployment, not as the production identity model.

**Exit criteria:** two users can be distinct, membership is enforced server-side, and the owner can revoke sessions without rotating a shared secret for everyone.

### Phase 4 — Sync correctness and recovery

**Goal:** Make multi-device behavior explainable and recoverable.

- Add a persistent sync queue with retry count and last error.
- Make sync state visible: synced, pending, offline, conflict, failed.
- Replace ambiguous timestamp-only behavior with server revision metadata where practical.
- Add deterministic merge tests:
  - offline edit on device A and B;
  - rename versus mark;
  - delete versus edit;
  - restore of a deleted item;
  - simultaneous reorder;
  - duplicate retry.
- Add a “last synced” diagnostic screen.
- Add one-click JSON backup download.
- Add validated restore with preview/diff before overwrite.
- Add scheduled database backups and perform a restore drill.

**Exit criteria:** a documented two-device test passes and a restore can be completed from a backup in a clean environment.

### Phase 5 — Product UX polish

**Goal:** Make the core workflow fast enough for repeated real-world use.

- Add a “Start audit” flow with resume state and recent sections.
- Add an explicit audit session/date rather than only lifetime marks.
- Add “mark all visible as…” with confirmation and undo.
- Add a clearer distinction between owned state, audit state, and purchase state.
- Improve buy-list editing: desired quantity, purchased quantity, store, priority, notes, and purchased/archive actions.
- Add sort options: section, urgency, store, cost, recently changed.
- Add compact mobile controls for gloved or one-handed use.
- Add keyboard shortcuts on desktop.
- Add empty/error/offline states for every view.
- Add import validation with actionable row-level errors.

**Exit criteria:** the owner can complete a representative audit on a phone without relying on desktop or developer knowledge.

### Phase 6 — Observability and production operations

**Goal:** Know when the app is failing and recover quickly.

- Add structured server logs with request IDs.
- Add error monitoring for API and client exceptions.
- Track non-sensitive metrics:
  - login success/failure;
  - sync success/failure/latency;
  - payload size and row count;
  - offline queue age;
  - restore/export usage.
- Add uptime checks for the app and health endpoint.
- Define alert thresholds and an incident runbook.
- Document Vercel rollback and database migration rollback.
- Verify backups monthly.
- Maintain a data-retention and privacy note.

If scheduled maintenance or backup jobs are added to Vercel, secure cron endpoints with a secret and make jobs idempotent; Vercel documents that cron invocations can overlap or be delivered more than once.

**Exit criteria:** an outage or failed sync produces a diagnosable signal, and the operator has a written recovery path.

### Phase 7 — Private beta and launch

**Goal:** Validate the product with real usage before broadening scope.

- Use the current owner as the first production user.
- Add one or two trusted workshop/household testers.
- Run a two-week beta with structured feedback after each audit.
- Measure:
  - audits started and completed;
  - weekly active use;
  - time to resume an audit;
  - sync success rate;
  - number of restored backups;
  - buy-list actions;
  - unresolved errors.
- Fix reliability issues before adding features.
- Publish a short privacy/data-handling page.
- Decide whether the product remains private, becomes a paid household tool, or becomes a broader inventory product.

**Launch gate:** no known data-loss path, passing CI, successful restore drill, successful two-device sync test, monitored production deployment, and documented rollback.

## Recommended implementation order

1. Add CI, branch protection, migrations, and clean test output.
2. Harden the current auth/sync API while it is still small.
3. Add workspace-aware schema without changing the visible single-workspace UX.
4. Replace shared passphrase access with real identity and session revocation.
5. Add sync queue, revision metadata, conflict tests, backup/restore.
6. Polish audit and buy-list workflows.
7. Operate a private beta.
8. Only then evaluate billing, teams, barcode scanning, or a frontend rewrite.

## Architecture alternatives considered

### Keep the current architecture

**Best for:** fastest personal MVP.  
**Pros:** lowest migration risk, cheap, preserves offline behavior.  
**Cons:** shared passphrase and hand-rolled monolith remain liabilities.

### Move to Next.js/React now

**Best for:** a product already proven to need a larger team and many routes.  
**Pros:** component boundaries, ecosystem, typed tooling.  
**Cons:** high rewrite risk, threatens offline behavior, does not solve auth/data correctness by itself.

**Recommendation:** do not rewrite before the MVP validation phase. First extract modules and add tests around the existing behavior.

### Move backend to a long-running VPS service

**Best for:** heavy background work, WebSockets, or operational control.  
**Pros:** full control, long-running processes, easier custom workers.  
**Cons:** more operations, patching, monitoring, backups, and failure modes.

**Recommendation:** keep Vercel Functions + Neon while traffic and workloads are small; revisit if sync, jobs, or file processing outgrow serverless constraints.

## Definition of production-ready MVP

The app is ready for production when all of the following are true:

- A user can sign in without sharing one global passphrase.
- A user can use the app offline and later sync without silent data loss.
- Two devices can edit different records and converge deterministically.
- Renaming an item never detaches its marks.
- Deletes propagate safely and can be undone or restored.
- API inputs are validated and bounded.
- Database writes are authorized by workspace membership.
- CI blocks broken deployments.
- Backups exist and a restore has been tested.
- Client and server errors are observable.
- The service worker update path is tested.
- Export and restore work on a clean browser.
- The owner can roll back a bad deployment.
- The product has a clear privacy and data-retention statement.

## Immediate next sprint

Create one focused production-readiness milestone with these tickets:

1. Add GitHub Actions CI.
2. Add branch protection and required checks on `main`.
3. Add API schema validation and request limits.
4. Add integration tests for auth and sync.
5. Add database migration tooling.
6. Add workspace/user/membership tables behind a feature flag.
7. Add structured error responses and request IDs.
8. Add client sync queue and visible sync diagnostics.
9. Add JSON backup restore preview.
10. Add Playwright mobile smoke test.
11. Add service-worker cache-version automation.
12. Document production setup, rollback, backups, and restore.

This sprint should improve safety and repeatability without changing the core product promise.

## Sources and current platform notes

- Vercel Functions limits and payload constraints: https://vercel.com/docs/functions/limitations
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Cron management, security, retries, and idempotency guidance: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Neon connection and pooling guidance: https://neon.com/docs/manage/endpoints/
