# ResourceDex

ResourceDex helps people share spare materials locally for free. An owner uploads a private photo, optionally uses Google Gemini identification with a consented NVIDIA Kimi K3 backup, corrects the suggestions, prepares private drafts, and explicitly publishes reviewed listings. A second account can discover and request a resource. Acceptance reserves it; pickup proposals and their revisions stay private to the participants.

This is an implementation demo built from [the PRD](PRD.md). The complete external pilot has additional acceptance gates listed below.

## Try the current demo

The hosted demo is [resourcedex.vercel.app](https://resourcedex.vercel.app); a local production preview can run at http://localhost:3012 against the same Supabase project. Verify the deployed commit before testing new features. Test credentials remain in private, ignored `tmp/demo-accounts.json`.

1. Sign in with the owner account in a normal browser window. Open Share, upload a photo, and choose manual entry or consent to Google identification and NVIDIA backup processing.
2. Review the detected items, including their names and categories. Continue, fill in the listing details and pickup area, then inspect the publication preview and publish.
3. Sign in with the requester account in a separate private window. Find the new listing in Explore and send a request.
4. As owner, open Requests → Incoming and accept. Propose private pickup details; use Requests → Outgoing in the requester window to agree or ask for a change.
5. For a labeled sample, use the explicit simulated-collection action. The six sample listings illustrate the product and offer no actual inventory.

The latest local checks passed 113 offline tests, lint, typecheck, and a production build. Recorded integration evidence includes 42 hosted backend checks and a real Kimi fallback/reference run in 53.4 seconds with five localized items and two mapped Habitat sources. These results are scoped to the tested code and environment; see [AI evidence](docs/ai.md), [the acceptance ledger](docs/acceptance.md), and safe artifacts in `output/qa`.

## Deploy to Vercel

Import the GitHub repository as a Next.js project with the repository root as its root directory. Node.js 22 is pinned in `package.json` and `.nvmrc`. Follow [the Vercel setup guide](docs/vercel.md) for environment variables, Supabase Auth redirects, and the hosted verification steps. The existing Vercel demo is live; each new deployed commit needs its own verification.

## Run locally

Use Node.js 22.12 or later and npm. From this directory:

The committed `.npmrc` preserves the peer-resolution mode used for the lockfile. This avoids an npm 10 optional Vitest/Vite devtools dependency-cycle error; a fresh `npm ci` has been verified with this configuration.

```sh
npm ci
cp .env.example .env.local
# Fill .env.local with your selected Supabase project and server credentials.
# Apply the committed migrations to that project before first use.
npm run dev -- --port 3012
```

Open http://localhost:3012. Supabase hosts accounts, data, and private images. Docker is needed only if you choose to run the isolated local Supabase development/test stack; the app also works directly against the configured hosted project.

The existing workstation configuration is already in ignored `.env.local`. Keep it private. The generated owner and requester test accounts are in ignored `tmp/demo-accounts.json`. Use separate browser profiles or a private window for the two roles. Sample listings are labeled and do not represent real supplies or actual pickups.

To prepare labeled sample data in the explicitly selected demo project:

```sh
node --env-file=.env.local scripts/seed-demo.mjs
```

For a production-mode local preview:

```sh
npm run build
npm start -- --port 3012
```

Stop the development process on that port first. For a hosted deployment, configure the same environment variables on the host, add its exact origin to Supabase Auth redirect URLs, and verify confirmation and password-recovery delivery. Database secrets and both AI provider keys stay server-only.

## Code map

| Location                        | Responsibility                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/app`                       | Routes, layout, and authenticated image/AI HTTP endpoints                                                  |
| `src/components`                | Product screens and reusable interface pieces                                                              |
| `src/lib/data`                  | Typed Supabase commands and reads                                                                          |
| `src/lib/supabase`              | Browser, per-request server, and administrative clients                                                    |
| `src/lib/ai`                    | Shared perception contract, provider fallback, private reference retrieval, review, and admission controls |
| `src/lib/images`                | Normalization, metadata removal, coordinates, and cropping                                                 |
| `src/lib/use-resource-draft.ts` | Serialized private autosave and explicit public-edit saves                                                 |
| `src/lib/use-scan-review.ts`    | Versioned persistence of corrections to model suggestions                                                  |
| `supabase/migrations`           | Database constraints, row permissions, and atomic workflow commands                                        |
| `tests` / `supabase/tests`      | Pure checks, browser flows, and live database/API integration                                              |

The database owns workflow state and authorization. Ordinary clients cannot assign owners, force availability, write model evidence, or bypass the request transitions. Publication validates and commits the exact reviewed revisions atomically. UI screens call small typed adapters; provider and administrative credentials remain in server-only modules.

## Validate

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Live integration tests create isolated fixtures in the selected ResourceDex project and clean up only their own records. Browser tests require the running app, seeded test accounts, and a Playwright Chromium installation.

```sh
npx playwright install chromium
npm run test:e2e
node --env-file=.env.local supabase/tests/backend.integration.mjs --hosted
```

Live Google/NVIDIA tests are opt-in. Their commands and cost boundaries are in [docs/ai.md](docs/ai.md). See [docs/backend.md](docs/backend.md) for local database checks and [docs/demo-runbook.md](docs/demo-runbook.md) for walkthrough steps. The [acceptance ledger](docs/acceptance.md) distinguishes implemented behavior, passing evidence, and pending PRD gates.

## Current scope

The working implementation includes real accounts, self-service account deletion, one/all unpublished-draft deletion, private photo normalization/cropping, Gemini identification with Kimi K3 fallback, private retrieval-grounded reference notes, durable owner review and drafts, reviewed publication, filtering and search, owner management, requests, reservation, private pickup revisions, completion history, and report submission. Photo batches inherit the first item's pickup area while preserving individual choices, and detected items use separate cropped photos. Styling is responsive, uses local fonts, and includes keyboard-accessible controls. Sample photo attribution is in [docs/photo-credits.md](docs/photo-credits.md).

The following remain before the complete PRD pilot is ready:

- Published source-grounded guidance, corpus expansion, immutable claim/revision evidence, and the required comparison evaluation. The four-entry private [reference notes](docs/reference-notes.md) feature does not complete that larger contract.
- Held-out photo evaluation, the full accessibility/device matrix, seeded-load performance checks, and deployed HTTPS/end-to-end email delivery verification.
- Scheduled retention and orphan cleanup, deletion semantics for previously published resources, operator moderation interface, and remaining non-AI abuse controls.

The app never treats a suggested identity as a verified material, dimension, condition, or safety certification. It does not claim the full PRD has passed because one live model request or a local build succeeded.
