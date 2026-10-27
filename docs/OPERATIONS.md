# Operations and release runbook

## Safety and evidence levels

No production database operation or deployment is authorized by this runbook. Obtain
separate approval for any production action. Never print source URLs, credentials,
session tokens, private row contents, or archives. `npm test` is mocked-client and
fixture evidence; Playwright adds real browser execution, not real API/DB integrity.
No backup schedule, alert service, recovery email provider, distributed limiter, or
production branch protection is claimed configured.

## Release and rollback

1. Record candidate SHA, actual deployment/project/branch mapping, last known-good
   deployment ID/SHA, migration set, operator, and expected worker version in a
   private release ticket. Do not assume remote `main` is the deployed branch.
2. Run `npm ci`, `npm run test:release`, backend isolation/concurrency tests, and
   fresh plus upgrade PostgreSQL migrations on disposable databases. Any failure
   blocks release; do not relax tests to bless missing behavior.
3. Use an approved development preview and isolated accounts/workspaces. Confirm
   API login, unauthorized and cross-account denials without effects, preserved
   mark details, stale revision handling, retry, audit→buy→export→reload→undo,
   second-browser readback, account switching and no private Cache Storage entries.
4. Physical iPhone gate: Safari and Home Screen app, tap/scroll/pinch zoom, 200% text,
   keyboard inputs, resume, interrupted requests, update from previous worker version.
   Desktop/mobile WebKit automation does not close this gate.
5. Complete backup/restore drill and recovery/access decisions below before wider
   access. Production promotion remains a separately authorized owner action.
6. After an approved release, read back deployed SHA/assets/API health, private
   authenticated write/read in an isolated workspace, second session persistence,
   logout/account switch, and returning-worker update. Health alone is insufficient.

Rollback rehearsal (development project only): record current and previous deployment
IDs, promote previous known-good deployment in the Vercel dashboard, then freshly
read back root HTML/script SHA and repeat isolated sign-in/write/read/account-switch
and worker-update checks. Record the exact operator action and observed target.
Production rollback requires approval and an already recorded compatible target.
A frontend rollback does **not** roll back migrations or recover data. Never reverse
migrations blindly or seed over existing data. If old frontend cannot use the new
API/schema, contain access and ship a forward fix. Use a separately approved restore
incident plan for data recovery; this tool will not restore a production target.

## Backup

Prerequisites: matching-compatible PostgreSQL client tools (`pg_dump`, `pg_restore`,
`psql`), approved source read access, secret delivery, sufficient encrypted disk,
private destination permissions and retention/offsite owner. No credentials in argv.
Obtain `DATABASE_URL` through a protected secret manager/environment (not a literal
shell command/history). Do not `set -x`. Run only on an approved source:

```sh
npm run backup-db -- /absolute/private/encrypted/backup-directory
```

The tool writes a custom archive with mode 0600, creates new directories 0700, uses
a temporary 0600 `PGPASSFILE`, passes connection fields via the child environment,
withholds subprocess diagnostics, and deletes partial archives on failure. Source
URLs/passwords are not passed in argv. Operator environments remain sensitive to
same-user/root inspection; restrict the runner. Only `sslmode` URL options are
supported; ensure CA/root-certificate configuration outside the URL if needed.
Unknown query options are not forwarded. No credential or archive is committed.
Successful dump exit alone is not restoration proof. Record checksum using a local
hash tool, timestamp, source identifier (not URL), file size, and tool version in
private operations records. Define retention/encryption/offsite ownership and test
retrieval before approving a backup schedule. No external job is created here.

## Disposable restore rehearsal

Never point this mode at the source database. Use a fresh empty local PostgreSQL
instance/database owned by an isolated unprivileged role, named `shop_restore_<suffix>`.
The script only accepts loopback hosts (`localhost`, `127.0.0.1`, `::1`) and that
name prefix; avoid SSH forwarding/tunnels or proxies to remote/production servers.
A loopback URL is a guardrail, not proof the underlying server is disposable.
Have a human verify the instance and empty target independently. No `--clean`,
`--create`, or database drop is issued by this tool.

```sh
# Set RESTORE_DATABASE_URL securely for the EMPTY disposable local database.
# DATABASE_URL is not used by restore mode.
CONFIRM_DISPOSABLE_RESTORE=yes npm run backup-db -- --restore-rehearsal /absolute/private/archive.dump
```

Restore uses `pg_restore --single-transaction --exit-on-error --no-owner
--no-privileges`, then a psql public-table query with `ON_ERROR_STOP`. Failures are
nonzero and diagnostics are withheld. Existing incompatible objects should fail,
not be dropped. For a full drill, compare source/target table and inventory counts,
foreign/check constraints, mark detail samples and tenant isolation in private
records; run the API against an appropriate disposable Neon development target
(the API HTTP driver cannot talk to plain local PostgreSQL directly). A local
restore validates the archive, not the API transport. Re-dump the disposable target
and compare logical invariants. Delete the disposable instance and local archives
only after recording evidence and confirming correct targets. No production restore,
rollback drill or database acceptance has been performed by this workstream.

Local environment blocker: PostgreSQL tools were not present during this workstream.
Backup subprocess contract/failure cleanup and restore target rejection were tested
using explicit fake executables; this is **not a PostgreSQL restore drill**. Install
approved compatible clients/server and complete the above gate before release.

## Private access and account recovery policy

Launch intent is owner-approved private accounts, not open signup. Current registration
UI/endpoint must not be confused with an enforced invitation gate. Until backend
allowlist/invitation enforcement and abuse controls are reviewed, do not widen access.
Required decisions: responsible owner, approved account list, identity-verification
procedure, invitation enforcement, recovery SLA, and audit/retention policy.

There is no implemented self-service reset/email-verification flow claimed here.
Recovery is currently a blocker, not a hidden admin command: an owner must verify
identity through a previously established out-of-band channel, approve a reviewed
recovery implementation/process, rotate credentials and revoke all sessions, and
verify old sessions fail and a new sign-in works without changing inventory. Never
ask users to send passwords/session tokens or recover by creating duplicate accounts
or changing workspace membership ad hoc. Do not hand-edit production hashes as QA.
A future reset flow needs single-use short-lived hashed tokens, approved delivery
provider/domain, uniform responses, throttling, session revocation and audit tests.

## Distributed rate limiting and observability follow-up

The existing process-local limiter is not shared across serverless instances. Before
public exposure, select an owner-approved shared store/provider and budget, define
login/register/recovery limits and trusted proxy/IP extraction, expiration/atomicity,
failure mode, retention/privacy rules and alert ownership. Add multi-instance abuse,
proxy-spoofing and provider-outage tests in a preview. Keep secrets in managed
settings and scrub identifiers from logs. No Redis/KV credentials, integrations,
external monitors or scheduled jobs were configured by this branch.
