# QA workstream evidence

## Parent-verified release candidate (supersedes historical failures below)

`BACKEND_TEST_DATABASE_URL=<explicit disposable loopback server> npm run test:release`
completed with exit 0 on the integrated tree:

- 29 actual-client workflow tests plus auth/mobile check.
- 28 worker/mobile/backend-safety unit tests; 9 operations checks.
- 39 real PostgreSQL 18.4 database/API tests, no skipped tests.
- 12 Chromium/WebKit in-memory-fixture browser journeys.
- 14 Chromium/WebKit **real HTTPS + production API handlers + PostgreSQL** browser
  journeys: secure sessions, 1,534 seeded items, latest rapid-tap intent, second-login
  persistence, metadata/undo, account isolation, no private cache, atomic bulk/version
  preconditions, native malformed-number safety, and serious/critical axe checks.
- 45 legacy reference checks pass with 29 disclosed jsdom diagnostics.

The HTTPS browser adapter replaces only Neon HTTP transport with local `pg`; real
handler logic, sessions, SQL, transactions and constraints execute. It is not a
live Neon/Vercel transport acceptance. Chromium's throwaway-certificate override
is confined to `playwright.postgres.config.js`; the fixture browser gate does not
use it. Invoke `npm run test:browser:database`, which fails if DB opt-in is absent.

Parent reran a real dump/restore: exact snapshot match (1 item, 1 detailed mark,
revision 2, 95 public constraints, archive 0600), temporary DB/archive cleanup.

The fixture version mismatch, pending-logout race, numeric-input data loss and
misleading invalid-draft feedback are fixed with regressions. Invalid numeric
drafts remain visibly unsaved across navigation/acknowledgments, block export,
and never become an accidental null clear. Intentional clear and zero pass in
both native browser engines against PostgreSQL.

Physical iPhone Safari/Home Screen, hosted CI and live Neon/Vercel migration/
deployment/readback are still separate release gates. Production is unchanged.
The lower sections preserve workstream history and are not the current pass/fail
status. Protected `CLAUDE.md` was not altered.

## Integrated local verification (current shared worktree)

This is local fixture-backed integration evidence, not real-API/PostgreSQL or
production release acceptance. The frontend, CSS and release-gate workstreams
were updating the shared tree concurrently; rerun gates after the final merge.
Only the four QA-owned files were edited by this integration pass.

### Results

- `node --test tests/ops/active-root.test.js`: **2 passed, 0 failed**.
  Reproduced the original `ENOENT` for `greenfield/app.js?v=10`, then fixed local
  file resolution using the URL pathname while preserving same-origin and
  supported-client-directory assertions. Query versions are not filesystem names.
- Added a failing fixture-contract regression before fixing the fixture. Initial
  failure was missing workspace `revision`; it now passes. Fixture GET `/state`
  returns workspace `revision` plus per-mark `version`. Existing marks start at
  version 1. Writes require production `validateMark` validation, return mark
  `version` and workspace `revision`, reject missing versions (428), reject
  `revision` as a mark field (400), and reject stale versions (409
  `revision_conflict`) without changing state. Production's pure validator is
  reused; no database/auth functions are invoked by the fixture.
- Latest `npm run test:browser`: **12 passed, 0 failed** (14.0 seconds), comprising
  six Chromium desktop and six WebKit mobile-viewport journeys, no retries.
  Normal journeys explicitly wait for an active controlling service worker;
  fault journeys block SW so interception remains deterministic. Passing original
  regressions include fresh reload persistence, account separation with no API
  entries in Cache Storage, serious/critical axe checks, and delayed rapid taps.
- Rapid-tap regression now polls for both acknowledgments instead of sleeping,
  checking mark versions `[2, 3]` and workspace revisions `[1, 2]` before reload.
  Failed-write coverage explicitly requires “not saved” feedback and rejects a
  “Saved” claim. Offline coverage follows the current read-only contract: visible
  offline notice, disabled audit controls, unchanged status, no write requests or
  automatic replay on reconnect, persisted state unchanged after reload, then
  session-expiry removal of private inventory.
- Latest `npm test`: **exit 1**. Syntax, mobile single-tap, **24 active-client
  workflow tests** and **28 unit tests** passed; ops reported **8 passed, 1 failed**.
  Remaining failure is `tests/ops/fixture.test.js:16`: it submits `{status:
  'missing'}` without required `version` and expects 200, receiving correct 428.
  That file is outside this agent's ownership. Parent must supply the GET-state
  mark version in its write and retain persistence/tenant-isolation assertions;
  do not relax the fixture or production precondition to make it pass.

### Remaining observed UI issue / coverage boundary

One intermediate Chromium account-switch run failed because the sign-in form
is editable while logout is still pending. The subsequent logout acknowledgment
re-rendered “You are signed out.” and discarded newly typed sign-in input. The
account-isolation journey now deliberately waits for confirmed sign-out before
entering beta credentials; it tests completed account switching, **not** this
pending-logout UX race. Frontend owner should disable/hide sign-in during pending
logout or preserve input. This observed issue is not claimed fixed.

No production operations, deployments, credentials, real database calls or
commits were performed by this QA integration pass. See the historical limits
below; those are not superseded by fixture-backed green browser results.

## Historical pre-integration evidence

Branch `work/qa-release`, runtime baseline `c4e476d`. This is not release acceptance.
Active client/API/worker were intentionally not changed by this workstream.

- `npm ci`: exit 0, 45 packages added, audit reported zero vulnerabilities; dependency
  deprecation warning for `whatwg-encoding` remains. This is not a security audit.
- `npx playwright install chromium webkit`: exit 0; both browsers installed and ran.
- `npm test`: active syntax and existing mocked jsdom suite passed; new ops tests
  exercise root HTML authentication against the local fixture, fixture tenant
  separation, backup credential handling/permissions/cleanup, collision protection,
  restore target rejection and transactional command contract. PostgreSQL commands
  in contract tests are deliberately fake executables, never a real database.
- Existing `tests/greenfield.js` failed once after clean install at line 29 (null
  status element after fixed-duration waits), then passed on reruns. That file is
  owned by the audit workflow agent; replace timing sleeps with state polling
  during integration rather than claiming the first run was clean.
- `npm run test:legacy`: exit 0, 45 PASS checks, **29 jsdom not-implemented diagnostics**.
  Output now explicitly labels legacy scope and says console/window error count
  excludes those diagnostics. They are not hidden or claimed as browser coverage.
- Final browser run: **12 tests, 4 passed, 8 failed**, symmetric across Chromium and
  WebKit. Passing: 503 write feedback/reload recovery and offline write/session-expiry
  journeys. Fault interception explicitly blocks SW to avoid worker interception
  hiding injected failures. Normal/account/cache journeys leave SW enabled.
- Four failures per browser are release-blocking findings on the unchanged baseline:
  1. Saved status reload reads stale `unknown` (worker-cached initial state).
  2. Cache Storage contains `/api/auth/me` and both fixture accounts' state URLs.
  3. Serious axe `color-contrast` finding targets `.item-store` on the checklist.
  4. Two rapid taps intend `missing`, but delayed first write wins as `have`.
  These assertions are retained, not skipped or weakened. Re-run after integrating
  B/C fixes; address the contrast finding in the CSS-owning workstream.

## Explicit blockers / scope limits

- `CLAUDE.md` update was blocked by protected agent-instruction-file write policy;
  it was not retried through another tool. Existing contents remain stale.
- `pg_dump`, `pg_restore`, `psql`, and `initdb` were not available on PATH. No actual
  PostgreSQL restore drill was performed. See `OPERATIONS.md` for executable guarded
  restore steps and required logical/API validation.
- No real-API Neon/Vercel development environment was provisioned, no production
  credentials were read, and no production DB operations/deployments occurred.
- No hosted CI execution, physical iPhone acceptance, production rollback rehearsal,
  private invitation enforcement, recovery service, shared rate-limit provider,
  backup schedule or external monitor has been asserted configured.
- Parent owns execution-board acceptance updates and combined feature/database gates.
