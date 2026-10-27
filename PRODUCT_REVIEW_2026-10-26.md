# Shop Inventory: product brief and stabilization roadmap

Assessment: October 26, 2026 (Mac local date). Code reviewed: `greenfield-ux` at `6a7e8c8`. Scope: repository, current production entrypoint, both test suites, and isolated local fault probes. No production data mutations or live iPhone validation performed during this review.

## Executive brief

**Recommendation: stop redesigning and ship a trustworthy audit loop.** The product has a clear job: help a workshop owner quickly record what they own, identify genuinely useful purchases, and resume on another device without losing work. The greenfield client is visually simpler, but it is not functionally equivalent to the original. Reliability and workflow continuity matter more now than another visual system or framework.

Positioning: **a private workshop audit and purchase-planning tool**, not a warehouse system or generalized SaaS. Primary user: an owner standing in a garage, often one-handed on an iPhone. Secondary context: desktop review and shopping preparation.

Core loop: find item → record status/count → see reliable save feedback → undo a mistake → turn confirmed gaps into a usable buy list → resume later.

### Existing wins worth preserving

- Rich, purpose-specific seed: 1,534 items across 19 sections and 100 subsections, rather than an empty inventory database.
- Small static frontend and Vercel/Neon architecture: no framework rewrite is needed to solve the current issues.
- Cloud workspace/session foundations and workspace checks in the targeted mark endpoint.
- Salted scrypt password hashes, timing-safe password comparison, random sessions stored as token hashes, and Secure/HttpOnly/SameSite cookies (`lib/cloud-auth.js`).
- Targeted mark writes in the shipped client instead of full-checklist writes for every tap.
- Useful status vocabulary, single-tap cycling, visible labels, store grouping, consistent design tokens, and mobile navigation.
- Existing legacy tests capture valuable domain behavior: undo, counted-consumable restock, exports, editing, and quantity handling. These are a specification to recover, not proof that the new client supports them.
- Migration, health, audit-event, CI, and backup scripts exist. These are foundations, not evidence of complete operational readiness.

## Findings, ordered by user and business impact

### P0 — Service worker caches authenticated API responses

Evidence: `sw.js:35-59` handles every GET, checks Cache Storage before the network, caches successful responses without an asset allowlist, and returns `index.html` on any network failure. `/api/auth/me` and workspace state are not excluded. Logout does not purge these caches.

An isolated VM probe of the actual worker returned `cached-user-A-state` for an authenticated workspace API request. This demonstrates routing behavior, not a production account leak. It creates stale reads and a potential same-browser cross-account privacy boundary failure. HTML fallback can also turn API failure into an apparently successful non-JSON response.

Fix: network-only `/api/*`, explicit API `Cache-Control: no-store`, static same-origin asset allowlist, navigation-only offline fallback, and a migration that purges existing cached API entries. Test logout/account switch and a second-browser read after writes. Offline shell availability must not imply offline inventory editing.

### P0 — Rapid taps can overwrite the user's latest choice

Evidence: `greenfield/app.js:100-103`, `saveMark()`. Every tap starts an independent PUT. Any response replaces the local mark; any failure restores its captured old value, regardless of newer actions.

Actual probe: two taps showed `missing`; resolving the second request before the first left the UI at `have`. Request ordering is also a server-write risk because the endpoint has no revision precondition. A boolean `saving` cannot represent multiple in-flight writes.

Fix: serialize/coalesce writes per item, keep a last-confirmed state and latest intended state, ignore obsolete responses, and add server revisions for explicit multi-device conflict behavior. This is online request coordination, not a durable offline queue. Preserve single-tap cycling and do not reintroduce the rejected popup.

### P0 — Status-only writes clear existing item details

Evidence: the shipped `saveMark()` sends only `{status}`; `api/workspaces/[workspaceId]/marks/[itemId].js:27-30` writes null for omitted `q`, `sp`, `n`, and `c` and updates all columns on conflict. Existing quantity, specification, notes, and cost can therefore be erased by changing status.

Fix: define field-preserving partial updates or send and validate the full existing mark. Prefer an explicit partial-update contract. Test a populated mark before and after every status change and after reload.

### P0 — Legacy and bulk APIs weaken tenant boundaries

Independent backend review, checked against the source:

- `api/sync.js:19,34-40` uses the old passphrase session; `lib/db.js:34-46,55-112` reads and upserts inventory without workspace predicates. This is a proven unscoped code path, not a confirmed live exploit: exposure depends on legacy credentials or still-valid legacy sessions. Disable the legacy endpoints for the cloud deployment, not merely their login screen.
- `state.js:41-46,92-94` protects existing rows during conflicts, but new rows can reference a different workspace's section, subsection or item. `003_inventory_tables.sql` has ID-only foreign keys, not composite tenant-aware relationships. Validate referenced ownership before writing and enforce `(workspace_id, id)` relationships in the database after safe backfill. No live cross-account exploit was attempted.
- The broad state API also lacks a revision/freshness precondition; the old full-snapshot client can overwrite newer data. Remove obsolete mutation paths or require expected revisions before exposing restored editing features.

Exit gate: two independent users cannot read, update, attach children to, or occupy the mark slot of each other's inventory, through any deployed endpoint. Add negative API/database integration tests, not only mocks.

### P1 — Redesign lost core product capabilities

The new client has no UI for undo, quantity entry, specs, notes, costs, item editing, exports, or conservative counted-consumable restock. These exist in the old client/tests. `renderBuy()` includes only three status values, not counted stock below target. This is feature loss, not streamlining by itself.

Product decision: restore quantities/restock, notes/specs, undo, and buy-list cost/export first because they complete the audit/purchase loop. Put structural checklist editing behind an explicit secondary mode. Do not restore every legacy preference merely for parity.

### P1 — The main test/CI gate largely tests the retired UI

`npm test` runs `tests/smoke.js` with `tests/legacy-index.html` and root `app.js`, not the shipped `greenfield/app.js`. The greenfield test uses a single mocked item with immediately resolved writes and only checks a small subset of the status cycle. CI runs `npm test` and syntax-checks old `app.js`, but does not run `test:greenfield`; branch push CI is limited to `main`.

Observed baseline: both suites exit successfully; legacy suite reports 45 passes but emits 29 jsdom not-implemented warnings. Neither passing suite establishes iPhone, authenticated database, offline, concurrency, or new-client feature parity.

Fix: make the deployed root client the default suite; keep legacy tests explicitly labeled. Add contract/integration tests and Playwright Chromium/WebKit journeys with delayed/reordered/failing requests, reload persistence, account switching, and accessibility checks. WebKit automation still does not replace real iPhone Home Screen acceptance.

### P1 — Navigation, search, and resume do not fully support the job

- The only Buy list link is in `.bottom-nav`; CSS hides that nav above 800px. Desktop users have no visible route to a central product outcome.
- `Continue audit` always chooses `model.sections[0]`, rather than the last or next incomplete section.
- One `query` and `filter` persist across routes; a home search can unexpectedly constrain the next section.
- Search finds matching sections, not direct item results. Items are flattened without subsection headings or an explicit sort on the normalized item list.
- Every input/mark response replaces the entire shell with `innerHTML`, risking focus and interaction continuity. Bulk marking loops over items, rerenders repeatedly, fires separate requests, and has no undo/aggregate failure presentation.

Fix: desktop primary nav; true resume; route-scoped query/filter state; direct item search; subsection grouping; stable row updates/focus; bounded transactional bulk action with undo and aggregate feedback.

### P1 — Mobile zoom was addressed with a broad accessibility tradeoff

`index.html:5` and `greenfield/index.html` disable scaling. Mobile status controls use `touch-action: none`, and auth inputs inherit a smaller field font. These are workarounds, not proof of resolved iPhone gestures. Do not claim an emulated 390px viewport proves physical iPhone behavior.

Fix: preserve user zoom, scope double-tap handling to controls without breaking pan/pinch, use at least 16px input text where needed, and test scrolling initiated on buttons, rapid taps, keyboard focus, Dynamic Type/200% text, Safari and standalone mode. W3C's Resize Text guidance requires text to remain usable at 200% [S1]. Keep the user's preferred single-tap flow.

### P1/P2 — Backend and operational consolidation

- Registration/workspace/session creation and bootstrap/full-state writes are multi-step rather than atomic. Bootstrap stops when any section exists, so partial initialization can become permanent.
- Fresh migration order is broken: `001_cloud_first.sql:52-55` alters inventory tables only created by `003_inventory_tables.sql`. Existing installations also do not acquire new CHECK constraints from `CREATE TABLE IF NOT EXISTS`. Rehearse both empty-database and legacy-upgrade paths, transact migration/version updates, and add explicit constraint migrations; do not rewrite applied migration history casually.
- Archived workspaces are excluded during default selection but direct APIs check membership without checking archive state. Define archive semantics and centralize the corresponding authorization policy.
- The full-state route remains a broad mutation surface beside the targeted mark API; legacy passphrase `/api/sync` is still deployed. Audit and then remove/disable obsolete paths after confirming no required clients use them.
- In-memory auth limits are process-local; public registration, missing password recovery, and lack of email verification do not fit a private-tool launch policy without an explicit access decision.
- Backup script exists, but this review found no restore drill or scheduled backup gate. Health checks do not prove restoration or private-data isolation.
- Production is deployed from `greenfield-ux`, while remote `main` remains at `6501873`; docs and `package.json` still mix local-first/optional-sync assumptions with cloud-first behavior.

Fix: transaction boundaries, cross-workspace integrity tests, bounded input validation, invitation/access policy, account recovery appropriate to that policy, automated backups plus restore rehearsal, and one release branch/path. Prefer validation/hardening over a new auth rewrite unless maintenance cost justifies a managed provider.

## Product scope

### Required for a dependable private MVP

- Fast single-tap statuses, field-preserving reliable writes, visible saving/failure/retry, undo.
- Counts with conservative restock behavior; notes/specs and purchase context.
- Find and resume work; useful desktop/mobile buy list with export.
- Private account/workspace isolation, usable sign-in/recovery, clear network state.
- Update-safe installable PWA; no cached private API state; no offline edits in this phase.
- Tests of the deployed client, repeatable release/rollback, restorable data.

### Defer

Billing, team administration, AI recommendations, barcode/supplier integrations, generic warehouse workflows, native apps, offline reconciliation, elaborate dashboards, and a framework rewrite. Figma/Storybook/custom MCP infrastructure is optional leverage, not a prerequisite to fixing the core loop.

## Sequenced roadmap

### 1. Trust and containment — next milestone

Work: exclude private API caching and clean old caches; field-preserving mark updates; per-item request coordination; visible retry/error; authorization and tenant-boundary tests; transactional writes where partial success is unsafe.

Exit: delayed/reversed/failed requests cannot silently replace the latest intent; status changes preserve all details; logout/account switch cannot display cached prior-user data; denied writes leave the database unchanged. Verify via real API reads in isolated workspaces, not only DOM mocks.

### 2. Product parity that earns its space

Work: undo; counts/restock; notes/specs; cost and purchase export; desktop nav; resume; direct item search; subsection headings; controlled bulk audit. Make checklist structure editing secondary.

Exit: one complete audit-to-shopping journey works at desktop and phone sizes, including reload and undo. Unknown consumables stay off the buy list; counted shortfalls appear. All differences from legacy are classified as restored, intentionally removed, or deferred.

### 3. Mobile/PWA quality and release gates

Work: preserve intentional zoom; repair touch handling without popups; stable controls/focus/scroll; network status and session-expired recovery; deliberate shell update/version UX. Put the active client into CI with Playwright and accessibility checks.

Exit: same task passes Chromium/WebKit; actual iPhone Safari and installed PWA pass rapid taps, scrolling, large text, auth keyboard, updates and interrupted requests. No claims of native-device verification from emulation alone. Playwright supports retrying UI assertions for observable state [S2].

### 4. Streamline the implementation and operations

Work: extract pure inventory rules, API adapter, write coordinator, route state, and small view components using ES modules or similarly light boundaries. Centralize status/mark contracts and validators. Index items/subsections instead of repeated whole-list scans. Remove legacy runtime/routes after parity/security tests; retain reference fixtures only where useful. Consolidate docs, default tests, CI and production branch. Schedule backups, perform restore drill, document rollback.

Exit: one supported frontend and auth path; documented local API development command; active tests are the normal command; production SHA maps to a reviewed commit; restore and rollback are demonstrated. Add shared rate limiting/monitoring before widening access.

## Success measures and proposed acceptance targets

These are targets to measure, not current benchmark claims:

- Zero observed lost latest-intent writes or cross-account cached data in release tests.
- Every write visibly transitions to Saved or Not saved with retry; no optimistic success presented as confirmed.
- At least 95% of mark acknowledgments within one second on the agreed reference connection; record real samples and failures.
- Resume reaches the next useful audit location in at most two actions.
- Every core journey passes the active-client release suite; no serious automated accessibility findings left unexplained; real iPhone sign-off remains explicit.
- Successful backup restore and production rollback rehearsal before expanding the user base.

## Verification record

- `npm test`: exit 0; 45 legacy checks pass; 29 not-implemented warnings.
- `npm run test:greenfield`: exit 0; limited mocked active-client status/auth checks.
- Actual-client delayed-response probe: intended `missing` regressed to `have` after reversed responses.
- Actual-worker routing probe: cached API state returned before network.
- Remote heads verified: `greenfield-ux` = `6a7e8c8…`; `main` = `6501873…`.
- No schema changes, production writes, runtime fixes or deployments made for this review.

## Sources

Repository evidence is cited inline by exact file/function. External references support only the stated standards/tool capabilities, not claims of product compliance.

[S1] W3C, Understanding SC 1.4.4 Resize Text: https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html

[S2] Playwright, Assertions: https://playwright.dev/docs/test-assertions

Further implementation reference: MDN, Using Service Workers: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
