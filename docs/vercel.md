# Deploy ResourceDex on Vercel

The existing hosted demo is [resourcedex.vercel.app](https://resourcedex.vercel.app), backed by ResourceDex Supabase. This guide covers the updated code. An earlier successful deployment does not establish that new Kimi fallback, reference notes, or draft deletion have been released; verify the production commit after each update.

## Import and build

Import the GitHub repository into a new Vercel project using these settings:

| Setting           | Value                                      |
| ----------------- | ------------------------------------------ |
| Framework preset  | **Next.js**                                |
| Root directory    | Repository root (`.`)                      |
| Install command   | `npm ci`                                   |
| Build command     | `npm run build`                            |
| Output directory  | Leave the Next.js default; do not override |
| Node.js version   | **22.x**                                   |
| Production branch | `main`                                     |

Commit both `package-lock.json` and `.npmrc`. The project `.npmrc` sets `legacy-peer-deps=true` to match the tested lockfile. Keep development and optional dependencies during the build: TypeScript, Tailwind, Next.js platform binaries, and Sharp need them. Vercel supports explicit install/build commands and detects Next.js output automatically. [Vercel build settings](https://vercel.com/docs/builds/configure-a-build)

Use `engines.node: "22.x"` in `package.json` and Node 22 in CI/local development. Vercel selects a supported major and rolls out its minor/security patches; an exact patch is not enforceable there. Avoid a broad range such as `>=22`, which can select a different major. [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

This is a server application: retain the API routes, Auth callback, and session proxy. Do not use static export or deploy only `public/`. No custom `vercel.json` is required for the current implementation.

## Environment variables

Add these in Vercel **Settings → Environment Variables** before building. Start with Production scope. Give Preview a separate Supabase project and budget if you need preview writes; a preview using production credentials can change real production data. Environment changes apply to new deployments, so redeploy after changing values. [Vercel environment variables](https://vercel.com/docs/environment-variables)

| Name                                   | Exposure             | Value / requirement                                                                                                              |
| -------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser              | `https://wdenmhvhnzrkhhvnnuyo.supabase.co` for the selected ResourceDex project                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser              | Publishable key from that same project                                                                                           |
| `SUPABASE_SECRET_KEY`                  | Server only          | Secret key from the same project; needed by private photo routes                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server only          | Legacy alternative to `SUPABASE_SECRET_KEY`; configure one, not both                                                             |
| `GEMINI_API_KEY`                       | Server only          | Google API key authorized for the selected model                                                                                 |
| `GEMINI_MODEL`                         | Server only          | Explicit image/JSON-capable model ID available to your account; `gemini-3.5-flash` passed the recorded implementation smoke test |
| `NVIDIA_API_KEY`                       | Server only          | NVIDIA NIM key authorized for the backup model                                                                                   |
| `NVIDIA_MODEL`                         | Server only          | Exact value `moonshotai/kimi-k3`; earlier models are not substituted                                                             |
| `AI_SCAN_MAX_COST_USD`                 | Server configuration | Positive conservative maximum allowance for one analysis attempt                                                                 |
| `AI_DAILY_BUDGET_USD`                  | Server configuration | Positive UTC-day allowance, at least the per-scan allowance                                                                      |

Public variables are intentionally available to browser code. The Supabase secret bypasses RLS and must never use a `NEXT_PUBLIC_` name. Keep secrets out of source, GitHub Actions logs, screenshots, issue text, and shared demo credentials. `.env.local` and `tmp/demo-accounts.json` remain ignored. The API does not need `DATABASE_URL`, a database password, or a Supabase Management API access token at runtime.

NVIDIA key/model configuration has been added to the selected project's Production and Preview environments; changed code still requires a deployment. Reserve an allowance for the complete possible Google + Kimi vision + reference attempt, using current provider pricing and output limits. Failed/timed-out attempts count. Missing all AI configuration permits manual listings; missing the Supabase server secret prevents preparing photos even for manual entry. See [AI configuration and evidence](ai.md).

## Supabase project and email setup

Vercel builds do not apply database migrations. Verify migration history before deploying database commands, including `20260912212852_delete_saved_drafts.sql` for owner draft deletion. If using a different project, deliberately apply the repository migrations there and verify Auth/RLS/Storage before setting its environment values; see [backend setup](backend.md). Do not make `scan-images` or `listing-images` public.

After choosing the final HTTPS domain, set Supabase **Authentication → URL Configuration → Site URL** to that origin, for example `https://your-resourcedex-domain.example`. Add callback allow-list entries for that exact hostname:

```text
https://your-resourcedex-domain.example/auth/callback
https://your-resourcedex-domain.example/auth/callback\?next=**
```

The second pattern retains the callback path while allowing the app's return-to-task query; `\?` matches the literal question mark in Supabase's glob syntax. Replace the example hostname. Add the same two entries for an explicitly trusted preview hostname when testing there, and for the actual localhost port only when needed. Prefer exact trusted hosts over allowing every `*.vercel.app` deployment. ResourceDex derives redirects from the current browser origin, so it does not read a `NEXT_PUBLIC_SITE_URL` variable. [Supabase redirect configuration and patterns](https://supabase.com/docs/guides/auth/redirect-urls)

Keep email confirmation enabled. Configure **custom SMTP in Supabase**, including a verified sender/domain, before inviting ordinary users. The default sender currently delivers only to project-team addresses with a small test quota; it is unsuitable for an external pilot. SMTP credentials belong in Supabase's Auth settings, not the app's Vercel variables. [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

Retain confirmation/recovery template links using Supabase's `{{ .ConfirmationURL }}`. The implemented callback exchanges a PKCE `code`; it does not implement an `/auth/confirm` token-hash route. Changing templates to an unrelated tutorial callback will break this flow. [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

Test signup/confirmation and password recovery on the final domain using the same browser/device that started each flow. PKCE needs the locally stored verifier, so an email opening in another browser may fail; this limitation remains relevant to a pilot. [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

## Runtime compatibility

The analysis route exports `runtime = 'nodejs'` and `maxDuration = 180`; preparation and listing-image routes retain 60 seconds. Keep Fluid Compute enabled and verify the deployed analysis function allows 180 seconds. Current Fluid Compute limits support it. Google has a 30-second deadline, Kimi vision up to 120 seconds, and reference generation up to 45 seconds within one 165-second overall deadline. The lease is 170 seconds, leaving time for persistence before the route limit. A timeout does not guarantee billing stops. [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)

The browser uploads the original image directly to a signed private Supabase Storage destination. App route bodies contain small JSON requests; photos and derivatives are read/written through Storage, with URLs returned to the browser. This accommodates the app's 10 MB photo limit without sending those bytes through Vercel's 4.5 MB request/response limit. Keep this transport when extending uploads. [Vercel payload limits](https://vercel.com/docs/functions/limitations)

Application state lives in Supabase, not a function filesystem or in-process job. Keep the private/no-store behavior in the Auth proxy and photo responses; do not add shared CDN caching for authenticated pages or signed URL responses. Guidance corpus ingestion is an explicit operator script, not a deployment/build command.

## Verify the deployed build

1. Confirm successful `npm ci` and `npm run build` logs, Node 22, and the expected production commit.
2. Browse signed out; sign up with a real email, confirm, sign out/in, recover the password, and verify return-to-task navigation.
3. Upload an actual JPEG/PNG/WebP, including an image over 4.5 MB but within 10 MB. Prepare it, correct a live identification, reload the saved review, and publish only after the public preview.
4. Use a separate account to discover/request that resource. Accept it, revise and agree pickup details, and record collection. Check visitor/unrelated-account access and private image access as described in the [demo runbook](demo-runbook.md).
5. Verify consented Google-rate-limit fallback reaches Kimi and private references resolve to real sources. Reference failure must preserve vision. Legacy Google-only consent, authentication errors, and refusals must not trigger NVIDIA. Check the exhausted-budget/manual-entry path.
6. Using disposable fixtures, delete one/all unpublished drafts and verify published resources survive; verify account deletion separately. Inspect logs without exposing images, signed URLs, tokens, or private pickup details.

Local browser and hosted Supabase checks establish only their exercised flows. Record the final URL, production commit, and fresh browser evidence for each release; earlier deployment evidence does not verify new behavior or email delivery.

Before an external pilot, complete email lifecycle verification, scheduled retention and deletion semantics for previously published resources, an actionable moderation workflow, abuse controls, and the outstanding quality/load/accessibility cases in the [acceptance ledger](acceptance.md). The last hosted advisor review reported leaked-password protection disabled; enable it where the plan supports it and recheck the advisor. Supabase currently offers this protection on Pro and above. [Supabase password security](https://supabase.com/docs/guides/auth/password-security)

Private starter reference notes are implemented for Kimi fallback. Full published guidance, claim/revision evidence, corpus expansion, and evaluation remain pending; see [reference notes](reference-notes.md). Keep seeded sample listings visibly labeled; they are simulated resources and must not be represented as real pickups.
