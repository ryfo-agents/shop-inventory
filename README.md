# Shop Inventory

Private, cloud-first workshop audit and purchase planning. The server is authoritative;
there is no offline inventory mutation queue and no optional local-first sync mode.
The supported root `index.html` loads `greenfield/app.js` and `greenfield/styles.css`.
Root `app.js` and `tests/legacy-index.html` are legacy reference material, not the deployed UI.

## Install and verify

Use Node 22+ and `npm ci` (lockfile committed).

```sh
npm test                            # shipped-client jsdom checks + ops/fixture tests + active syntax
npm run test:legacy                 # explicitly retired-client reference checks
npx playwright install chromium webkit
npm run test:browser                # real browsers + axe against isolated in-memory HTTP fixture
npm run test:release                # all of the above; any failure blocks release
```

`npm test` does not prove live API/database acceptance. `tests/greenfield.js` uses mocked
fetch. Browser journeys serve the actual root assets, use test-only cookies, and run
against `tests/browser/fixture-server.js`, **not production handlers or PostgreSQL**.
They cover sign-in, status save/reload, account switching, private cache detection,
delayed/reversed writes, failed writes, offline attempts, session expiry, and serious/
critical axe findings. Fault-interception journeys block service workers deliberately;
account/cache and normal journeys leave workers enabled. Each journey gets a new
loopback server and fresh in-memory state. Mobile WebKit is not physical iPhone proof.
Traces/videos/screenshots are disabled; never point the fixture harness at production.
CI runs active/syntax/operations, labeled legacy, and Chromium/WebKit on work branches
and PRs. A local pass is not evidence that hosted CI has run.

## Local development

```sh
npm run qa:fixture
# http://127.0.0.1:4173 — fixture ONLY, no external calls/database/secrets
```

Fixture accounts: `alpha@example.test` / `beta@example.test`, password
`fixture-password-only`. All data vanishes on restart. No provisioning or real
password recovery is represented by this fixture.

`npm start` serves static files at port 8899 only; it **does not implement `/api`**
and cannot sign into the real cloud app. For real API development use the Vercel
CLI in a separately approved, linked **development** project (`npx vercel dev`,
not `--prod`) and a dedicated development Neon branch/database. Install/authenticate
that CLI deliberately; it is not a configured repository dependency. Supply only
development environment settings via your secret manager or protected `.env.local`.
Do not pull production settings into local QA. Real session cookies use `Secure`:
verify HTTPS/cookie behavior in a development preview if the local browser rejects them.
The Neon HTTP driver is not a plain localhost PostgreSQL wire client; local Postgres
alone does not make the API run. See [operations](docs/OPERATIONS.md) for real-API gates.

## Architecture and boundaries

- `api/auth/password-login.js`, `register.js`, `password-logout.js`, `me.js`: account/session handlers.
- `api/workspaces/[workspaceId]/state.js`, `checklist.js`, `marks/[itemId].js`: cloud workspace state.
- `lib/cloud-auth.js`: account/session and workspace helpers; `db/migrations/`: schema history.
- `data/checklist.json` / `.md`: factory seed inputs, not live authoritative inventory.
- `sw.js`: worker; private API data must never enter Cache Storage or HTML fallback.
- `scripts/migrate.js`: migration runner, explicit operator action only.
- `scripts/backup-db.js`: manual protected backup and guarded disposable restore rehearsal.

Keep single-tap six-state cycling, mark details, conservative counted-consumable
restock, undo, and server-confirmed save feedback. Do not assume legacy editor parity.
Checklist structure editing is dependent on safe authorized transactional APIs.

## Release status

Read `EXECUTION_PLAN.md` and `PRODUCT_REVIEW_2026-10-26.md` before changing behavior.
A passing mocked test is not a database, physical-device, deployment, restore, or
recovery acceptance. Remaining release blockers and operational prerequisites live
in [the operations runbook](docs/OPERATIONS.md). No production deploy or scheduled
backup/monitoring integration is configured by these instructions.
