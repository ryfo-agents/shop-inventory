# Mobile/PWA acceptance evidence (work/mobile-pwa)

## Implemented

- `/api` and `/api/*`, all methods: direct `fetch` with `cache: no-store`; no Cache Storage lookup/write and no HTML fallback.
- Only exact same-origin public shell URLs are cached. Asset queries pin shell version 10 in both entrypoints. Unknown paths, query variants and cross-origin requests are not cached.
- Known shell navigations are network-first/no-store, with the install-time HTML snapshot used only on network failure. Navigation never updates that snapshot behind a running shell. Versioned assets are cache-first, without background replacement.
- Installation uses atomic `addAll`; a missing core asset fails installation rather than promoting a broken shell. Activation deletes historical `shop-inv-*` caches and removes non-allowlisted entries from the current cache, preserving unrelated caches.
- The worker activates promptly to contain the old privacy issue. It does **not** reload existing pages: updated HTML provides an inline, explicit “Finish saving, then reload” cue on controller change. Initial install does not show a spurious update. Offline/reconnected/registration-failure notices live outside the rerendered application root. They do not queue or automatically retry writes.
- Zoom locks and `touch-action: none` removed. Controls use manipulation gestures, inputs are at least 16px, body text follows root text sizing, controls have 44px targets, safe-area insets are independent, and reduced motion is respected. Faint text contrast and enlarged brand clipping found during browser checks were corrected.
- Manifest retains root identity/start/scope and standalone mode, uses the current theme, and no longer forces portrait orientation. Existing 192px/512px icon dimensions are checked.
- CSS hooks for frontend integration: `.item-details`, `.detail-fields`, `.save-state`, `.save-error`, `.undo-bar`, `.desktop-nav`. The frontend owner must align its markup with these or add equivalent rules during integration; this branch does not edit `greenfield/app.js`.

## Reproduction

From the repository root with normal development dependencies installed:

```sh
node --test tests/worker.test.js tests/mobile.test.js
npm run test:greenfield
node --check sw.js
git diff --check
```

Optional browser evidence needs `playwright` and `axe-core`; package/CI changes belong to the QA owner. This work used isolated scratch dependencies rather than changing project packages:

```sh
npm install --prefix "$HOME/.hermes/cache/scratch/shop-pwa-browser" playwright axe-core --no-audit --no-fund
"$HOME/.hermes/cache/scratch/shop-pwa-browser/node_modules/.bin/playwright" install chromium webkit
NODE_PATH="$HOME/.hermes/cache/scratch/shop-pwa-browser/node_modules" node tests/mobile-browser.js
```

The runner creates an ephemeral loopback HTTP server and fresh nonpersistent browser contexts. Its only writes are synthetic in-memory marks and disposable local-origin caches. It never calls a deployed service or reads an existing browser profile. Evidence defaults to `$HOME/.hermes/cache/scratch/shop-pwa-evidence/` (`results.json`, phone screenshots, large-text screenshots).

## Observed results

- Worker/mobile Node tests: **17 passed, 0 failed**. Regression tests first demonstrated the old cached-account API response and non-navigation HTML fallback, then passed after fixes. Install-failure, migration, allowlist, query/version, offline, API method and network-only behavior are covered in the worker VM harness; it is not a real API/database test.
- Existing active-client suite: `GREENFIELD MOBILE SINGLE-TAP CHECK PASSED`. One initial run under concurrent load failed at its fixed 10ms hash-navigation wait; isolated reruns passed. That pre-existing timing fragility is not repaired in this branch.
- Legacy suite: **45 checks passed**, with **29 existing jsdom not-implemented warnings**. This is reference coverage, not evidence for the deployed UI.
- Optional browser runner: **exit 0 in Chromium and WebKit**. It verifies 44 layout samples across overview/section/buy/settings, widths 320/390/844/1280 (844×390 landscape), 200% root/body text at 390px and all four routes at 320px, and auth. Samples have no horizontal overflow, undersized visible buttons, inputs below 16px, blanket gesture locks, or clipped enlarged brand text.
- axe WCAG 2 A/AA and 2.1 AA scans: **zero violations** on the sampled section and auth pages in both engines. This is sampled automated evidence, not a compliance claim.
- Real browser worker checks: seeded v9 private cache removed, exactly seven public core entries remain, account A→B fetch reads B, offline API fetch rejects, offline navigation loads the shell without fixture account data, and reconnect cue appears. This seeds an old cache; it does **not** simulate a previously controlling v9 worker.
- Both engines: complete six-state tap cycle, keyboard activation, no status chooser/dialog and unchanged viewport scale after taps. Chromium synthetic touch scrolling starts on a status button and moves the page; synthetic pinch reaches ~1.5× scale.
- No online uncaught JS errors observed. WebKit additionally reports intentionally rejected offline service-worker fetches as `TypeError: Load failed`/request-URL page errors; the runner records these separately rather than claiming an error-free offline console.

## Release/manual gates still open

1. **Physical iPhone Safari and installed Home Screen PWA:** rapid repeated taps, scroll gestures initiated on controls, intentional pinch, keyboard input/autofill, Dynamic Type, notch/home-indicator safe areas in both orientations, VoiceOver/focus, suspended/resumed requests, installation and upgrades. Desktop WebKit and Chromium mobile emulation do not establish this acceptance.
2. Re-run against the combined frontend/backend changes. Browser APIs here are deterministic loopback fixtures, not authenticated PostgreSQL or deployed account isolation tests. The frontend owner remains responsible for disabling offline mutations and for reliable pending-write/error behavior.
3. Exercise an actual upgrade from a **controlling** v9 worker with isolated accounts. New worker policy starts at successful activation; it cannot retract a private response already returned by v9 or erase old UI state in an already-open page. Existing pages are not forcibly reloaded mid-save. Close/reopen or explicitly reload them after pending saves finish during release verification.
4. Confirm backend/API `Cache-Control: no-store`, release headers, complete atomic deployment of versioned HTML/assets, preview installability, and service-worker update readback. No deploy or production write was performed.
5. On future shell changes, bump `SHELL_VERSION` in `sw.js` and the `?v=`/`data-shell-version` values in **both** HTML entrypoints together, then update corresponding version expectations. Never reuse a version while changing shell assets.
