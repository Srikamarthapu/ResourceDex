# ResourceDex backend

The app uses Supabase Auth, Postgres and private Storage. The database is authoritative for availability. Clients can read authorized rows; they cannot write listing state, request state, evidence, ownership or moderation fields directly. Validated RPCs perform those changes in transactions.

## Selected environments

- Hosted project: `ResourceDex` / `wdenmhvhnzrkhhvnnuyo`, PostgreSQL 17, US West 2. Selected by the user on September 12, 2026. No other hosted project was modified.
- Local project: `ResourceDex`, API `http://127.0.0.1:56321`, database port `56322`, test mail viewer `http://127.0.0.1:56324`. Separate ports preserve the existing local application on 54321/54322.
- Browser configuration: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Server-only configuration: `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`. The administrative client lives in a `server-only` module. Never prefix either secret variable with `NEXT_PUBLIC_`.

The local CLI binds its services to all interfaces by default. Use only test data locally, and do not expose the local stack as a production service. Local email confirmation remains enabled; Mailpit receives local email instead of sending it externally.

## Code map

- `src/lib/supabase/browser.ts`: browser cookie client and configuration check.
- `src/lib/supabase/server.ts`: per-request cookie client and separately named server administrative client.
- `src/lib/supabase/proxy.ts`: verified session refresh and private/no-store cache headers.
- `src/lib/data/resources.ts`: typed listing reads, full draft save, atomic publish, withdraw, area/profile reads and 5-minute image signing.
- `src/lib/data/requests.ts`: participant-only request reads, atomic transitions, private pickup proposals and revision-aware agreement.
- `public.scan_reviews`: private owner corrections keyed by scan and analysis version; service-only compare-and-set writes retain earlier snapshots.
- `supabase/migrations/`: repeatable schema, grants, policies and commands. Files were initially created with `supabase migration new`; filenames match the versions assigned when the same SQL was applied to the selected hosted project.
- `supabase/tests/backend.integration.mjs`: real Auth, Storage and PostgREST integration checks, using ephemeral test-owned records and three distinct accounts.
- `scripts/seed-demo.mjs`: non-destructive, explicitly targeted sample setup. Generated credentials are stored only in ignored `tmp/demo-accounts.json`.

## Data and access

Every exposed table has RLS. All ordinary table grants are explicitly revoked before intended reads and profile display-name updates are granted. This avoids differing local/hosted default privileges. The `analysis_attempts` table has no ordinary client privileges. Command results, operator membership and audit events live in an unexposed `private` schema with no ordinary table grants.

`resources` contains public-safe owner facts. Private drafts and withdrawals are visible only to the owner; visible available/reserved resources are public. Completed resources and their listing derivatives remain visible to the owner and fulfilled requester. All image buckets are private. Storage rechecks authorization when issuing signed URLs; an already-issued URL can remain usable until its five-minute expiry.

Request rows are visible only to their requester and listing owner. Pickup details require the accepted requester or owner. Canceled requesters lose access immediately. Fulfilled participants lose pickup-detail reads after 30 days. A background deletion job is still required to physically remove those expired details.

The profile trigger copies only a bounded display name from user metadata. Authorization never depends on editable user metadata. Every ordinary workflow command verifies the current Auth user has a confirmed email and is not an anonymous account.

Privileged command implementations live in the unexposed `private` schema, use an empty fixed `search_path`, and verify the actor before writing. Thin public RPCs use security invoker and individual execution grants. Service-only AI reservation/completion RPCs have execution explicitly revoked from ordinary roles.

## Supported transitions

- Save a new draft or edit an owned draft, withdrawn or available resource. Edits require the revision the caller saw. An available-content edit increments the revision and cancels pending requests with “Listing updated; request again.” Reserved and completed content cannot be edited.
- Publish 1–20 reviewed drafts/withdrawn records atomically. Validation requires complete listing facts, an active area, positive quantity or named lot, working declaration for tools, alt text, and a ready owner-owned listing derivative that exists in Storage. A persisted operation key prevents duplicate publication; the command also requires the exact listing revisions shown in the public preview.
- Withdraw a resource, canceling all pending/accepted requests in the same transaction.
- Request an available whole listing, rejecting self-requests and duplicate active requests. Retry with the same operation key returns the original request.
- Accept exactly one request under a resource-row lock; decline other pending requests. Lock order is resource, request, then pickup throughout the workflow.
- Cancel an active request and release an accepted reservation. Declined requests never reactivate automatically.
- Propose/revise private pickup details as owner; every revision clears agreement. Owner edits must supply the proposal revision seen when the form opened, including zero for a first proposal. A requester must submit the current revision when agreeing or requesting a change.
- Record collection as owner, atomically completing the listing and fulfilling the accepted request.
- Submit a report. An operator assigned through trusted database administration can hide/restore a resource; hiding closes affected requests. There is no user-editable operator role.

Draft saves are serialized through their local revision commits and check the active account. Review/save waits for edits made while earlier writes are in flight. Public-content editing uses explicit reviewed saves, while private drafts may autosave. Two deterministic save-queue tests cover competing autosave/review callers and recovery after failure.

## Local verification

Discover CLI commands with `--help` when running a new version. From the repository root:

```sh
supabase start --exclude studio,logflare,vector,edge-runtime,realtime,imgproxy
supabase status -o json > /tmp/resourcedex-local-status.json
node supabase/tests/backend.integration.mjs
supabase db lint --local --schema public,private --fail-on error
supabase db advisors --local --type security --level warn
```

The status file contains local test keys; do not commit or share it. The integration script permits only the dedicated local port by default. It creates temporary verified accounts, exercises real APIs and deletes only the IDs it created. There is no table truncation.

An explicit hosted run is restricted to the selected ResourceDex URL:

```sh
node --env-file=.env.local supabase/tests/backend.integration.mjs --hosted
```

Test publications are marked `is_sample=true` before they become visible. Admin-confirmed demo/test accounts are distinct Supabase accounts using normal password authentication. Production email verification is not disabled.

## Sample catalog

```sh
node --env-file=.env.local scripts/seed-demo.mjs
```

This prepares six labeled examples using the licensed photos documented in `docs/photo-credits.md`, plus separate owner/requester accounts. Every sample description states that the illustrated supplies are not offered for a real pickup; condition, material and counts remain unknown. `is_sample` is assigned only through the trusted seed, never from an ordinary client. No sample is counted as a real exchange. Credentials remain in ignored `tmp/demo-accounts.json`; do not publish them in a repository or expose an automatic-login endpoint. Reruns preserve existing interactions and do not reset accepted/completed samples.

## Verification evidence and remaining gates

The same integration suite passed all 42 checks against both local Supabase and the hosted ResourceDex project on September 12, 2026. It covers unauthorized draft/scan/attempt/image access, blocked direct state writes and foreign image attachment, live cross-account publication, idempotent commands, concurrent acceptance, stale pickup agreement, cancellation revocation, content-edit revision invalidation, stale publication previews and owner pickup edits, indexed material search, explicit unknown normalization, completion history and image access, and service-only AI budget/completion commands, versioned review persistence, stale review conflicts, reanalysis retention and owner isolation.

The final hosted schema review has four informational `rls_enabled_no_policy` notices for intentionally deny-by-default server-only tables (`private.audit_events`, `private.command_results`, `private.operator_users`, `public.analysis_attempts`). Do not add broad policies merely to remove these notices. See the [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). The final advisor refresh also reports an Auth warning: leaked-password protection is disabled. Enable it before an external pilot if the selected plan supports it; [Supabase currently requires Pro or above](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No plan was upgraded.

Still required before declaring the complete PRD delivered:

- Hosted visual two-session walkthrough and production email verification/recovery delivery checks.
- The held-out photo and RAG evaluations, approved source corpus and citation/evidence tables; this foundation does not fabricate guidance or claim RAG support.
- Scheduled retention/orphan cleanup and actual deletion workflows. Read-time expiry is implemented for fulfilled pickup details; physical deletion is not yet scheduled.
- Owner resource/draft deletion with minimal counterpart history, account-deletion runbook and audited operator-support workflow.
- Moderation console and operator report review UI. Server commands exist; operator assignment remains a trusted database administration action.
- Normalized numeric dimension fields, detailed per-field review/provenance history and a durable scan-candidate relation. This foundation uses owner-entered dimension text and stable scan/candidate references without pretending they are measured observations.
- Rate limits for ordinary publishing/requests/reports, performance targets at the PRD's seeded load, and operational alerting. AI admission limits use a shared database reservation, but configured provider pricing and evaluation remain separate gates.

Current Supabase references used during implementation: [SSR client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [database functions and execution privileges](https://supabase.com/docs/guides/database/functions), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), and [the explicit Data API grant change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
