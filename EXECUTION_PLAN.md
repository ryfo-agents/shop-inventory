# Shop Inventory execution board

Baseline: `3de0ebb` on `greenfield-ux`. Authority: `PRODUCT_REVIEW_2026-10-26.md`. This board tracks implementation, not promises of acceptance. Production stays unchanged until combined review and verification.

## Product invariants

- Private cloud-first workshop audit; server is authoritative. No offline inventory mutation queue.
- Preserve single-tap six-state cycling on desktop and mobile; no status popup.
- Preserve quantity, specs, notes, cost and unknown-consumable exclusion when changing status.
- Do not modify real-user inventory during QA. Use isolated fixtures/workspaces and clean up.
- No framework rewrite, billing, teams, AI, barcode/supplier features.
- No secrets in repository, output, screenshots or reports.

## Workstreams and explicit tasks

### A — Backend/data safety (`work/backend-safety`)

- [x] A1 Disable legacy passphrase login/logout/sync mutation surface for cloud deployment, including acceptance of old signed sessions.
- [x] A2 Centralize authenticated active-workspace authorization across checklist/state/mark APIs.
- [x] A3 Implement field-presence-aware mark updates; omission preserves existing details and explicit null clears permitted fields.
- [x] A4 Add revision/precondition protection for concurrent writes; atomic mark and audit persistence.
- [x] A5 Validate parent/item ownership before bulk writes; enforce tenant-aware FK constraints with explicit safe migration/backfill and rejection of inconsistent rows.
- [x] A6 Make provisioning/bootstrap atomic and idempotent; validate methods before effects; prevent partial sections-only initialization.
- [x] A7 Fix fresh/upgrade migration path without silently rewriting applied history; transactional migration/version recording; fixture tests.
- [x] A8 Provide transactional bounded bulk status updates and safe snapshot revision behavior, or disable unsupported broad writes until safely implemented.
- [x] A9 Negative tests: cross-tenant reads/writes/references, archived workspaces, partial writes, stale revisions, metadata preservation.

Acceptance: all denied writes are effect-free; concurrent writes have explicit behavior; fresh/upgrade fixtures pass; legacy routes fail closed; no detail loss. Handler mocks are not a substitute for PostgreSQL integrity tests.

### B — Core audit workflow (`work/audit-workflow`)

- [x] B1 Per-item online write serialization/coalescing; stale responses/failures cannot override latest intent; full mark preservation.
- [x] B2 Visible saving/failure/retry; session-expiry recovery; no false Saved.
- [x] B3 Undo status/count and bulk actions with bounded history.
- [x] B4 Inline/progressively disclosed quantity, spec, note and cost controls; restore conservative restock and useful buy-list totals/export.
- [x] B5 Desktop primary navigation and meaningful resume location.
- [x] B6 Route-scoped search/filter; direct item search; subsection grouping and deterministic order.
- [x] B7 Stable focus/scroll during interactions; bounded bulk flow and clear aggregate feedback.
- [x] B8 Secondary checklist editing if safe API contract available; otherwise explicitly defer without false parity claim.
- [x] B9 Extract small domain/API/write/view boundaries as useful; no dependency-heavy rewrite.

Acceptance: actual-client tests of delayed/reversed/failed writes and preserved mark details; audit→buy→export→reload→undo journey; no popup or offline edits.

### C — Mobile/PWA (`work/mobile-pwa`)

- [x] C1 Network-only API handling, static asset allowlist, navigation-only fallback and cache migration purging private responses.
- [x] C2 Restore intentional zoom; scoped manipulation gestures; 16px auth/input text, safe areas and touch targets without blocking scroll.
- [x] C3 Deliberate shell update/version behavior and visible update/network cues where appropriate.
- [x] C4 SW unit tests: API requests never cached/fallback; old cache cleanup; asset/navigation behavior; offline behavior.
- [x] C5 Verify responsive layouts and accessibility with browser tools; document actual-iPhone acceptance as manual hardware gate if unavailable.

Acceptance: no private API responses in caches; user zoom preserved; no blanket touch-action:none; app remains installable. Do not equate emulation with physical iPhone verification.

### D — QA/release/operations (`work/qa-release`)

- [x] D1 Default test gate covers deployed client; label legacy suite and remove misleading pass/warning claims.
- [x] D2 CI runs active tests/syntax on work branches/PRs; add Playwright Chromium/WebKit journeys and axe checks.
- [x] D3 Reusable isolated authenticated QA fixture flow, no tokens/real-user state in reports; network-fault and account-switch journeys.
- [x] D4 Safe backup procedure with credentials out of process args where possible; restore rehearsal against disposable database, never production.
- [x] D5 Consolidate README/project instructions/package metadata/local API development/release and rollback documentation.
- [x] D6 Document private-access/account-recovery policy and distributed rate-limit follow-up with real prerequisites; no fabricated configured integrations.

Acceptance: one normal command verifies active client; tests identify mocked vs real API/database/browser evidence; restore/rollback runbook is executable and blockers explicit.

## Integration/release tasks (parent agent)

- [x] I1 Review each branch diff and real test output; reconcile API contracts (field-preserving PATCH/PUT, revisions, bulk requests).
- [x] I2 Merge workstreams into integration branch; resolve overlapping tests/config intentionally.
- [x] I3 Run active, legacy, API, migration, worker, browser and accessibility gates; address regressions.
- [x] I4 Independent security/correctness reviewer on combined diff; fix blockers and re-run.
- [x] I5 Preview using isolated data; production deploy only after release gates pass and rollback target recorded.
- [x] I6 Fresh readback: deployed SHA/assets/API health, authenticated write/read, second-session persistence, account switch, mobile browser checks.
- [x] I7 Update this board with evidence, remaining hardware/service blockers, commit IDs and URLs. Never mark a gate done from an agent self-report alone.

## Dependencies

A and B use a preservation-aware mark body `{version,status,q,sp,n,c}`. `version` is mandatory, zero for an absent mark, then taken from each server acknowledgment; workspace `revision` is not a mark precondition. The backend offers an atomic bounded bulk endpoint; the UI intentionally uses a clearly labeled capped sequential batch with partial-failure feedback. Structural checklist editing is explicitly deferred. C owns HTML/CSS/SW; B frontend JS; D package/CI/browser harness/operations; A API/lib/db/migration runner.

## State

- Implementation branches merged locally into `integration/product-stabilization`: backend `53aa88a`, workflow `98eb3ec`, PWA `050312d`, QA/release `474e2d6`.
- Parent ran `npm run test:release` with disposable PostgreSQL 18.4: 29 workflow tests plus active auth/mobile checks; 28 unit tests; 9 ops checks; 39 real database/API tests; 12 fixture-browser journeys; 14 real HTTPS/API/PostgreSQL Chromium/WebKit journeys; 45 legacy reference checks. All passed; legacy suite still emits 29 disclosed jsdom diagnostics.
- Real dump/restore was rerun by parent: exact one-item/one-mark metadata snapshot, revision 2, 95 public constraints, 0600 archive, fixture DB/archive cleanup.
- Backend independently approved after quarantine-collision/auth-input regressions. UI numeric-draft fix passes native Chromium/WebKit+PostgreSQL tests; final independent re-review approved on October 27, 2026 with no remaining blocking findings.
- Physical iPhone Safari/Home Screen acceptance remains an explicit hardware follow-up; user authorized production release on October 27. Live Neon migrations, Vercel promotion, authenticated readback, second-session persistence and account-switch checks are complete. Do not widen access before invitation/recovery/rate-limit policy is implemented.
- Structural checklist editing is deliberately deferred; undo is session-local. CLAUDE.md is a protected legacy instruction file and was not modified; README and current roadmap document the actual cloud-first architecture.
- Production release: merged runtime `6519f49`, deployment `dpl_DhNcnUj6VffYNAsKbWhbhUDaSqfz`; public root and assets match merged files byte-for-byte. Two isolated QA accounts removed; all pre-existing user/checklist/mark fields compare unchanged to the pre-migration backup. See `docs/RELEASE_2026-10-27.md`.
