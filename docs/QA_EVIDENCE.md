# QA workstream evidence (pre-integration)

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
