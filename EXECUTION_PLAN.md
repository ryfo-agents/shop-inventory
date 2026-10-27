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

- [ ] A1 Disable legacy passphrase login/logout/sync mutation surface for cloud deployment, including acceptance of old signed sessions.
- [ ] A2 Centralize authenticated active-workspace authorization across checklist/state/mark APIs.
- [ ] A3 Implement field-presence-aware mark updates; omission preserves existing details and explicit null clears permitted fields.
- [ ] A4 Add revision/precondition protection for concurrent writes; atomic mark and audit persistence.
- [ ] A5 Validate parent/item ownership before bulk writes; enforce tenant-aware FK constraints with explicit safe migration/backfill and rejection of inconsistent rows.
- [ ] A6 Make provisioning/bootstrap atomic and idempotent; validate methods before effects; prevent partial sections-only initialization.
- [ ] A7 Fix fresh/upgrade migration path without silently rewriting applied history; transactional migration/version recording; fixture tests.
- [ ] A8 Provide transactional bounded bulk status updates and safe snapshot revision behavior, or disable unsupported broad writes until safely implemented.
- [ ] A9 Negative tests: cross-tenant reads/writes/references, archived workspaces, partial writes, stale revisions, metadata preservation.

Acceptance: all denied writes are effect-free; concurrent writes have explicit behavior; fresh/upgrade fixtures pass; legacy routes fail closed; no detail loss. Handler mocks are not a substitute for PostgreSQL integrity tests.

### B — Core audit workflow (`work/audit-workflow`)

- [ ] B1 Per-item online write serialization/coalescing; stale responses/failures cannot override latest intent; full mark preservation.
- [ ] B2 Visible saving/failure/retry; session-expiry recovery; no false Saved.
- [ ] B3 Undo status/count and bulk actions with bounded history.
- [ ] B4 Inline/progressively disclosed quantity, spec, note and cost controls; restore conservative restock and useful buy-list totals/export.
- [ ] B5 Desktop primary navigation and meaningful resume location.
- [ ] B6 Route-scoped search/filter; direct item search; subsection grouping and deterministic order.
- [ ] B7 Stable focus/scroll during interactions; bounded bulk flow and clear aggregate feedback.
- [ ] B8 Secondary checklist editing if safe API contract available; otherwise explicitly defer without false parity claim.
- [ ] B9 Extract small domain/API/write/view boundaries as useful; no dependency-heavy rewrite.

Acceptance: actual-client tests of delayed/reversed/failed writes and preserved mark details; audit→buy→export→reload→undo journey; no popup or offline edits.

### C — Mobile/PWA (`work/mobile-pwa`)

- [ ] C1 Network-only API handling, static asset allowlist, navigation-only fallback and cache migration purging private responses.
- [ ] C2 Restore intentional zoom; scoped manipulation gestures; 16px auth/input text, safe areas and touch targets without blocking scroll.
- [ ] C3 Deliberate shell update/version behavior and visible update/network cues where appropriate.
- [ ] C4 SW unit tests: API requests never cached/fallback; old cache cleanup; asset/navigation behavior; offline behavior.
- [ ] C5 Verify responsive layouts and accessibility with browser tools; document actual-iPhone acceptance as manual hardware gate if unavailable.

Acceptance: no private API responses in caches; user zoom preserved; no blanket touch-action:none; app remains installable. Do not equate emulation with physical iPhone verification.

### D — QA/release/operations (`work/qa-release`)

- [ ] D1 Default test gate covers deployed client; label legacy suite and remove misleading pass/warning claims.
- [ ] D2 CI runs active tests/syntax on work branches/PRs; add Playwright Chromium/WebKit journeys and axe checks.
- [ ] D3 Reusable isolated authenticated QA fixture flow, no tokens/real-user state in reports; network-fault and account-switch journeys.
- [ ] D4 Safe backup procedure with credentials out of process args where possible; restore rehearsal against disposable database, never production.
- [ ] D5 Consolidate README/project instructions/package metadata/local API development/release and rollback documentation.
- [ ] D6 Document private-access/account-recovery policy and distributed rate-limit follow-up with real prerequisites; no fabricated configured integrations.

Acceptance: one normal command verifies active client; tests identify mocked vs real API/database/browser evidence; restore/rollback runbook is executable and blockers explicit.

## Integration/release tasks (parent agent)

- [ ] I1 Review each branch diff and real test output; reconcile API contracts (field-preserving PATCH/PUT, revisions, bulk requests).
- [ ] I2 Merge workstreams into integration branch; resolve overlapping tests/config intentionally.
- [ ] I3 Run active, legacy, API, migration, worker, browser and accessibility gates; address regressions.
- [ ] I4 Independent security/correctness reviewer on combined diff; fix blockers and re-run.
- [ ] I5 Preview using isolated data; production deploy only after release gates pass and rollback target recorded.
- [ ] I6 Fresh readback: deployed SHA/assets/API health, authenticated write/read, second-session persistence, account switch, mobile browser checks.
- [ ] I7 Update this board with evidence, remaining hardware/service blockers, commit IDs and URLs. Never mark a gate done from an agent self-report alone.

## Dependencies

A and B coordinate via parent; use preservation-aware mark body `{status,q,sp,n,c}` and optional server revision. Bulk/editing is dependent on safe backend support. C owns HTML/CSS/SW. B owns frontend JS/domain modules. D owns package/CI/browser harness/operational docs and backup script. A owns API/lib/db/migration runner. Cross-owner edits require parent integration, not shared-file races.

## State

Initial tasks queued. Workstream branches fork baseline independently. Production is not changed by dispatch.
