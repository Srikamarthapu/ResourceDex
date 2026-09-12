# ResourceDex demo and manual QA runbook

Use this with [acceptance.md](acceptance.md) and the [PRD](../PRD.md). These are test procedures, not a record of passing results. Record actual commands and evidence against the current build. Run mutation and concurrency cases against labeled test records in the demo/test environment.

## Prepare the environment

1. Follow the repository setup instructions and environment template. Install with the committed lockfile's package manager, then run the project's type, lint, unit/integration and production-build scripts. Record actual output and failures; do not invent a script that is absent from `package.json`.
2. Apply committed migrations to the intended demo/test Supabase project and verify database and Storage policies. If using local Supabase, confirm Docker is running before `supabase start`. Do not reset a database containing non-test records.
3. Configure the app's origin, Auth verification/recovery redirects and working email delivery. Keep service credentials and Gemini credentials server-only.
4. Use a hosted HTTPS app for the PRD demo. Record URL, build identifier, selected Gemini model IDs, prompt/schema versions and active File Search corpus version. Check live vision/JSON and File Search capability; a model name in configuration is insufficient evidence.
5. Prepare separate browser sessions for verified **owner A**, verified **seeker B**, and verified **unrelated user C**; also use a signed-out visitor. Keep test credentials out of screenshots, source files and evidence notes.
6. Prepare an actual photograph with 3–6 visible in-scope supplies; a portrait/rotated example; JPEG, PNG and WebP fixtures; an oversized file; an invalid-image file; and a no-in-scope-items image. Use files you have permission to upload. Keep personal context and exact addresses out of shareable evidence.
7. Prepare 8–12 clearly labeled sample listings without overwriting real records. Index and retrieval-check the reviewed corpus in advance. Ensure quota and spend budget permit the intended provider test.
8. Open an evidence record using the template in `acceptance.md`. A failed prerequisite is a named blocker for its dependent cases; continue independent local/UI cases.

## First milestone: live sharing and discovery

| ID | Procedure | Expected result |
| --- | --- | --- |
| D01 | Signed out, open Explore and a public detail link. Enter Share, then sign in as A. | Public browsing works; protected action requires verified account; intended destination is preserved. |
| D02 | A starts Share, selects a real photo, inspects preview, replaces it, and then selects the final image. | Only the selected image is analyzed; original remains private. Google image-processing and publication disclosure appear before analysis. |
| D03 | Run live identification. Select each list row and corresponding box. Rename one candidate, change category, remove one candidate and manually add another. | Matching focus/highlight; <=12 stable candidates; meaningful unknowns; removed entries do not publish; manual item works without a box. |
| D04 | Save edits and refresh after the server shows Saved. Resume the review. Rerun analysis after changing a label. | Saved values persist; completed run reloads; new analysis version does not silently overwrite corrections. |
| D05 | Choose two items. Confirm titles/descriptions, quantity or named lot, condition, tools' working status, area and free availability; leave material/dimensions unknown where appropriate. | Required fields validated; unknown values remain readable; no invented composition, dimension or condition claim. |
| D06 | Request guidance after review. Open one claim's source details; remove one optional suggestion. | Live claim has real active source identity/version and applicability; individual removal works; no citation badge transfers to owner-edited text. |
| D07 | Choose each public image or crop, edit alt text and open final publication preview. Publish the two selected resources. | Preview matches public fields/background; explicit publication; only selected validated items commit together; stable links are returned. |
| D08 | In B's separate session, find the new items using keyword/category/area filters. Open the stable link, refresh, and open again signed out. | Same committed Supabase records and approved images; filters survive URL reload; neither local browser storage nor account switching simulates sharing. |
| D09 | Keep B's discovery screen visible while A withdraws a test listing. Repeat with explicit refresh and window focus. | Resource disappears within 10 seconds or on explicit refresh; direct inaccessible link gives neutral unavailable message. |

Record publication IDs, safe screenshots from both sessions and actual provider versions. D01–D09 alone do not satisfy the full P0 checklist or the held-out evaluation gates.

## Full P0: request, reserve and collect

| ID | Procedure | Expected result |
| --- | --- | --- |
| P01 | B requests an available listing with a note and pickup window; refresh. C requests the same listing. | Both requests persist as pending; listing remains available; user sees that owner acceptance is required. |
| P02 | A reviews incoming requests and accepts B. Observe B and C in their separate sessions. | One accepted request and reserved listing commit together; C is declined with a clear reason; state refreshes within 10 seconds. |
| P03 | A enters test meeting place, window and timezone. B agrees. A changes the proposal while B has an old tab open; B attempts to agree from that old tab. | Details are private; change increments arrangement revision and clears agreement; old revision cannot agree. |
| P04 | B requests a change; A updates the arrangement; B agrees to the current revision. | Structured change request and revised agreement survive refresh; no public chat or exact location leak. |
| P05 | Explicitly state that this is a simulated test handoff. A selects Mark as collected. Refresh both participants and Explore. | Owner-recorded completion atomically fulfills the request and completes the listing; it leaves Explore and remains in participant history. |
| P06 | On a second reservation, cancel as B. Attempt to reopen old pickup details. | Listing becomes available only if the same visible reservation still belongs to B; B immediately loses future pickup reads; other declined requests remain declined. |
| P07 | On a third test listing, create a pending request, then edit listing content as A. Try accepting the stale request. | Revision increments; request cancels with listing-updated reason; guidance is hidden; stale acceptance fails. Reserved listings reject content edits until canceled. |
| P08 | Report a test listing as B; hide and restore it using authorized operator tooling. | Report is private; hide removes visibility, cancels requests and is audited; restore leaves withdrawn until owner review. Ordinary profile changes cannot grant operator status. |
| P09 | Delete a completed test resource as A; inspect B's history and image access. | Only minimal closed/unavailable history remains; photo and description disappear; new image access is denied. |

## Failure and privacy cases

| ID | Procedure | Expected result |
| --- | --- | --- |
| F01 | Submit JPEG, PNG and WebP; then unsupported, >10 MB, spoofed extension and excessive-dimension fixtures. | Accepted formats normalize safely without upscaling; invalid content is rejected server-side; unrelated edited fields survive. |
| F02 | Use rotated/portrait and smaller-than-2,048-pixel photos. Inspect server dimensions and output metadata using test tooling. | Orientation correct, location metadata stripped, longest edge capped without enlargement. |
| F03 | Exercise no objects, 12-candidate limit, malformed output, refusal, invalid box and provider-timeout fixtures through the test harness. | Honest empty/partial/error messages; bad boxes omitted; usable drafts and manual entry remain; no fabricated live result. |
| F04 | Trigger no-evidence, withdrawn source, missing annotation and provider-failure cases. Edit a draft while guidance is in flight. | Distinct no-evidence/unavailable state; no unsupported or stale claims attach; manual publication remains possible. |
| F05 | Throttle/disconnect before a draft save completes; navigate away; reconnect and retry. Repeat for publication after a possible server commit. | No false Saved/Published message; retry/discard choice preserves known state; retry resolves original commit without duplicate listings. |
| F06 | Expire A's session while editing; reauthenticate. | Saved drafts remain private and resumable; no loss of already acknowledged edits; intended screen restored. |
| F07 | Copy A's private scan, draft, original-image and analysis identifiers. Attempt reads as visitor, B and C through the UI, app API, direct database API and Storage. | No unauthorized content or raw provider records returned. Record status and safe response shape, not private payloads. |
| F08 | Attempt foreign image attachment, ownership change, direct workflow-state assignment, fabricated evidence write and self/duplicate requests as ordinary clients. | Server/database rejects each bypass even if UI controls are skipped. |
| F09 | Copy accepted pickup request ID; attempt reads as visitor/C, then cancel as B and retry as B. | Only authorized current participants read details; canceled requester is denied immediately. Public listing/API/analytics payloads contain no exact pickup fields or Auth email. |
| F10 | Get a public image URL, withdraw/hide listing, request a new URL, then check the old URL after its configured expiry. | New URL issuance denied immediately; any already-issued URL follows documented expiry; no claim of recalling downloaded copies. |
| F11 | Exercise configured per-user analysis/request limits and daily AI spend ceiling. | Excess calls refused honestly; at most one bounded automatic provider retry; manual sharing and browsing still work. |
| F12 | Run retention against aged test fixtures and referenced controls; inspect deleted-resource/account-deletion workflow. | Eligible data removed at configured horizons, referenced assets preserved, other users' resources unaffected. |

## Concurrency and retry verification

Run these through the integration harness or two coordinated authenticated test requests. Record committed database state after each race; a UI toast is not sufficient.

- **Publish retry:** Submit the same two-draft payload twice with one operation key, including a simulated network loss after commit. Expect the same IDs and exactly two listings. Reuse that key with a different payload and expect rejection.
- **Atomic batch:** Include one invalid/stale selected draft with one valid draft. Expect zero published records from that command; derived images remain private for cleanup.
- **Two accepts:** With B and C pending, A accepts both concurrently. Expect exactly one accepted request, one reserved listing and a useful loser response.
- **Accept versus edit/withdraw:** Race A's acceptance with a content update or withdrawal. Expect one valid final transition; no accepted stale revision or active request on a withdrawn listing.
- **Cancel versus hide/complete:** Race cancellation with operator hiding or owner completion. Expect no reopening of a hidden/withdrawn/completed resource and consistent request status.
- **Stale agreement:** Submit agreement for revision 1 after proposal revision 2 commits. Expect conflict and current proposal, never agreement to revision 2 by implication.

## Visual and accessibility pass

Exercise Explore, detail, authentication, Share/review, My resources and Requests at desktop, 390 px and 320 px. At each size verify no horizontal overflow, readable photos and text, visible essential actions, persistent field labels and understandable empty/error/loading states. Repeat the core path at 200% text size.

Use only the keyboard through upload controls, candidate selection, image approval/crop or uncropped option, guidance source disclosure, publication and requests. Confirm visible focus, logical order, dialogs that return focus, no focus traps and actions that do not depend on dragging. Use a screen reader to verify field errors and save/analysis/publication announcements. Test reduced motion. Measure ordinary text contrast against 4.5:1 and check approximately 44 px touch targets.

Verify Available/Reserved/Completed/Unknown and Free/area labels use readable text. No invented progress percentages, confidence percentages, environmental impact, precise-distance claim or unlabeled sample inventory should appear.

## Evaluation and final evidence

The PRD requires >=20 held-out photos containing >=100 in-scope objects and 30 reference cases before calling the demo ready. A manually checked presentation photograph is not that evaluation. Report precision/recall raw counts, IoU results, supported and unsupported claims, no-evidence behavior, model/prompt/schema/corpus versions, latency and actual cost. Run the matched with/without-RAG comparison before claiming that RAG improved results.

Before presenting, repeat the live upload/provider/database smoke check and D01–D09 against the actual hosted build. For the full MVP, repeat P01–P09 and applicable access/concurrency/retention cases. Save the URL/build, role labels, publication/request IDs, sanitized screenshots or recording, test outputs, known failures and remaining gates. Keep secrets and exact private pickup details out of the evidence bundle.

If the live provider fails, say so and continue manual sharing. Show a stored analysis or recording only with a timestamp and **Recorded example** label. Describe that presentation's AI portion as incomplete. Distinguish local implementation preview, live shared-discovery milestone, and complete P0 status using the acceptance ledger.
