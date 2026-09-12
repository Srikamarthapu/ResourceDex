# Photo identification and private images

The pipeline uses Supabase private Storage, Google Gemini for primary identification, and NVIDIA-hosted `moonshotai/kimi-k3` as an explicitly consented backup. Both providers use the same perception prompt and validated candidate schema. Successful backup identification can add private retrieval-grounded reference notes. Manual listing creation remains available.

## Configuration and deadlines

- `GEMINI_API_KEY`: server-only Google API key.
- `GEMINI_MODEL`: an exact image/JSON-capable model identifier verified for the account; no guessed default.
- `NVIDIA_API_KEY`: server-only NVIDIA NIM API key.
- `NVIDIA_MODEL`: exact value `moonshotai/kimi-k3`. Other identifiers are rejected; earlier Kimi models are not silently substituted.
- `AI_SCAN_MAX_COST_USD`: conservative allowance for the complete possible primary vision, backup vision, and reference attempt. Account for both providers' current pricing and output limits.
- `AI_DAILY_BUDGET_USD`: maximum reserved allowances in a UTC day. Failed, timed-out, and stopped calls count because ending a request does not guarantee provider billing stops.
- Supabase public URL/publishable key and server secret: see the environment template and [backend runbook](backend.md).

`reserve_analysis` serializes budget checks in Postgres and enforces 10 attempts per owner per hour and 30 per UTC day. A partial unique index permits one running scan per owner. One reservation covers the bounded attempt; actual provider usage and fallback/retrieval metadata are recorded separately from that allowance.

Google has a 30-second deadline, NVIDIA vision up to 120 seconds, and reference generation up to 45 seconds, all capped by a 165-second overall deadline. The persisted lease is 170 seconds; the analysis route allows 180 seconds. Lease/revision checks stop an expired run overwriting a newer result. Each inference is submitted once; NVIDIA's asynchronous 202 response is polled as the same request.

The backup runs after a Google 429, network failure, 5xx, timeout, or missing Google configuration, only when NVIDIA is configured and the current provider consent is present. Google authentication errors (401/403), malformed successful output, and refusals do not trigger fallback. A failed reference pass preserves successful vision results without inventing notes.

## Browser contract

1. `POST /api/scans` with `{fileName,mimeType,size,operationKey}`. Keep a stable UUID when retrying the same upload. The response supplies a private scan and signed upload destination.
2. Upload bytes directly with Supabase `uploadToSignedUrl`; never proxy the allowed 10 MB photo through a Next.js request body.
3. `POST /api/scans/:id/prepare` validates JPEG/PNG/WebP bytes, rejects images above 10 MB or 40 megapixels and animated inputs, rotates EXIF orientation, strips metadata, and produces a JPEG up to 2,048 pixels on its longest edge without enlargement. The raw upload is removed; only normalized previews are signed.
4. Disclose Google image processing and NVIDIA backup processing before analysis. Send `{imageHash,operationKey,consent:true,providerConsent:"google-nvidia-v1"}` to `POST /api/scans/:id/analyze`. Legacy requests without `providerConsent` remain Google-only. Replaying a key restores its saved outcome; a deliberate new attempt uses a new UUID. Analysis never publishes anything.
5. `GET /api/scans/:id` restores safe status, candidates, analysis/review versions, and a fresh five-minute image preview. The response includes the owned operation key, start time, and deadline. Expired work and its matching attempt become failed atomically. The browser polls while processing or reconnecting; a reload recovers persisted results or resumes status checks. Closing a tab does not explicitly cancel a run, although the hosting runtime may still interrupt it. Stored reference notes are rechecked against current sources before returning them.
6. `POST /api/scans/:id/review` accepts `{analysisVersion,expectedReviewVersion,candidates:[{candidateId,label,category,selected}]}`. Send the complete visible list, up to twelve entries. Omitted originals are retained as removed private entries. Corrections persist without replacing pixel evidence; changed names/categories clear reference notes. Manual IDs use `manual:<UUID>` and receive no invented observations or bounds. Stale analysis/review versions return HTTP 409. Earlier snapshots remain private after reruns.
7. `POST /api/scans/:id/image` with `{operationKey,crop?}` creates a private approved derivative. Named crop coordinates use `x_min,y_min,x_max,y_max` on a 0–1000 scale. Valid detected items get separate crops; missing bounds and manual items retain the full photo. Owners can adjust/reset crops before publication.

Routes verify Auth/email and scan ownership before privileged access, reject cross-origin browser mutations, validate request shapes, and return private/no-store responses. No caller-supplied owner ID is trusted. Signed URLs are short-lived capabilities; do not log or persist them in public data.

## Stopping and recovering identification

`POST /api/scans/:id/cancel` accepts only `{operationKey}` after authenticated ownership and origin checks. Its service-only database command locks the scan before the attempt, changes only the matching active operation, and returns fresh status plus `cancelled`. Completion, cancellation, and reservation use the same scan lock order. A late cancellation cannot stop a newer operation; a late provider result cannot complete a stopped one. Photos, earlier candidates, reviews, and admission cost history remain intact.

The Share screen enables Stop after the server confirms the operation is running. Check status and automatic polling resolve slow or interrupted responses without issuing another inference. If a different photo is occupying the owner's single active slot, a 409 includes only that owner's active operation metadata. The current photo stays selected while the owner stops the earlier run or opens its completed review.

The worker checks its durable operation every 2.5 seconds and aborts Gemini, NVIDIA inference/status polling, and reference generation when stopped or replaced. This ends this app's processing and rejects late output; it cannot promise an upstream provider stops already scheduled computation. Cancellation is terminal and never triggers backup inference. Database status checks are bounded, and all polling is disposed when the worker finishes. Lease expiry remains the recovery path if a hosting instance disappears.

Offline regression covers provider cancellation, late responses, reference-pass cancellation, monitor cleanup, and browser attempt state. The September 12 cancellation update passed the production build, lint, TypeScript, the disposable-account lifecycle test, and the desktop/320px browser recovery test. Route regressions also cover delayed duplicates, cancellation before reservation, and replay during a newer operation. No provider requests were required for these deterministic failure tests. The opt-in database test uses disposable accounts and no AI calls:

```sh
RUN_LIVE_ANALYSIS_LIFECYCLE_TESTS=1 npm test -- tests/analysis-lifecycle-live.test.ts
```

## Perception and reference boundaries

`src/lib/ai/detection.ts` contains the shared versioned prompt, schema, strict parser, and coordinate adapter. Both adapters request `[y_min,x_min,y_max,x_max]`; storage uses named bounds. Bad localization retains an explicitly unlocalized suggestion; invalid identity fields, duplicates, excess candidates, and malformed JSON reject the result. Twelve candidates triggers an incomplete-result hint. Coordinates refer to the orientation-normalized image. The model provides no calibrated confidence or safety certification.

Private RAG uses the four-entry implementation-reviewed EPA/Habitat corpus in `knowledge/starter-corpus.json`. Local retrieval filters active, current entries by category and ranks them against each detected label/description. A separate Kimi call selects applicable source IDs. The server resolves each item binding and displays only the corpus's exact paraphrase, conditions, and canonical link. Notes do not replace image observations or enter published descriptions. Identity corrections clear them; subsequent reads suppress withdrawn, changed, or stale sources. See [private reference notes](reference-notes.md).

The existing Gemini File Search ingestion remains an independent capability demonstration. `node --experimental-strip-types scripts/ingest-knowledge.ts` explicitly creates/indexes a versioned store, attaches source IDs/hashes/version metadata, and verifies actual returned annotations before marking its registry ready. September 12 evidence indexed four entries and mapped three sources; see `output/qa/file-search-smoke.json`. NVIDIA fallback uses the bundled collection, so retrieval is independent of Google's quota.

Full PRD published guidance remains pending: a 20–30-entry reviewed corpus, immutable claim/revision evidence, owner approval and public withdrawal behavior, and the 30 reference cases with a measured with/without-RAG comparison. These private starter notes do not establish usefulness, source-support accuracy, or improved image recognition.

## Verification

On September 12, 2026:

- `gemini-3.5-flash` completed the licensed tools-photo smoke in 6.4 seconds with five candidates (`output/qa/gemini-smoke.json`). The authenticated Gemini API smoke took 23.8 seconds and covered upload, normalization, persistence, ownership, corrections, revisions, and replay (`output/qa/photo-pipeline-smoke.json`).
- Exact `moonshotai/kimi-k3` vision returned five localized candidates in 62.5 seconds (`output/qa/nvidia-smoke.json`). With a simulated Google 429 confined to the test, the real Kimi fallback/reference smoke passed in 53.4 seconds: 37.0 seconds for vision plus 16.4 seconds for references, with five localized items and two valid Habitat sources whose displayed notes matched the reviewed text and URLs (`output/qa/nvidia-fallback-smoke.json`). There is no production force-fallback switch.
- The combined offline suite passed 113 tests with five opt-in tests skipped; lint, typecheck, and the production build passed. These results do not replace a new deployed-browser check or the required held-out 20-photo/100-object evaluation.

Live tests make real provider requests only when explicitly enabled:

```sh
RUN_LIVE_AI_TESTS=1 npm test -- tests/ai-live.test.ts
RUN_LIVE_PHOTO_API_TESTS=1 PHOTO_TEST_APP_URL=http://localhost:3012 npm test -- tests/ai-api-live.test.ts
RUN_LIVE_NVIDIA_TESTS=1 npm test -- tests/nvidia-live.test.ts
RUN_LIVE_NVIDIA_FALLBACK_TESTS=1 npm test -- tests/ai-fallback-live.test.ts
```

Direct adapter smokes and ingestion run outside the application's Postgres cost reservations. API tests use isolated verified accounts, publish nothing, and clean up their own uploads/users. `tests/nvidia.test.ts` and `tests/reference-grounding.test.ts` exercise adapter and retrieval failure/binding contracts without live calls; mocked selections are not provider-quality evidence.

Relevant primary documentation: [Google image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Google structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Kimi K3 inference](https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer), [Kimi K3 status polling](https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-statuspolling), [File Search](https://ai.google.dev/gemini-api/docs/file-search), [Supabase signed uploads](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl), and [Sharp metadata handling](https://sharp.pixelplumbing.com/api-output/). Re-run the opt-in smoke after changing SDK, model, prompt, or hosted configuration.
