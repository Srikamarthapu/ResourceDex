# ResourceDex acceptance ledger

Source: [ResourceDex PRD v1.0](../output/pdf/ResourceDex-PRD.pdf), September 12, 2026, all 34 pages. [PRD.md](../PRD.md) contains the same 50 numbered functional requirements; no substantive conflict was found during the initial review. The PRD describes required behavior and proposed targets, not results already achieved.

This ledger separates an implementation preview, the first shared-discovery milestone, and the complete P0 product. Change a status only when linked evidence supports that specific environment and build. A local mock, successful build, or deployed page does not establish the integration gates.

## Status vocabulary

- **Not verified:** Required evidence has not been collected. Code may exist.
- **Pass:** The stated behavior was exercised successfully; link the result and build.
- **Partial:** The linked cases passed, but the full gate includes additional unverified cases.
- **Fail:** Observed behavior violates the requirement; link a reproducible finding.
- **Blocked:** The required test cannot run; name the actual missing prerequisite.
- **Later:** Explicitly outside P0 in the PRD.

## First shared-discovery milestone

The PRD's first independently demoable milestone is stages 1–3: manual sharing, photo review, and grounded guidance through discovery by a separate account. A usable local interface may be shown earlier as an **implementation preview**, with live and sample capabilities labeled. The phrase **PRD demo ready** additionally requires the evaluation and hosted evidence below.

| Gate                                  | Acceptance evidence                                                                                                                                                                                             | Status                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup and capabilities                | Reproducible install/build, committed migrations and policies, environment template; live Gemini vision/JSON and File Search smoke tests with pinned model IDs                                                  | Partial — typecheck/lint/unit/build and live provider smoke evidence recorded below; deployment and release setup remain open                                                         |
| Auth (AUTH-01–05)                     | Visitor browse; verified owner and independent seeker; sign-up, verification, sign-in/out, recovery and return-to-task on hosted URL                                                                            | Partial — standard sign-in, return-to-task, independent sessions and visitor gates passed; account lifecycle remains unverified                                                       |
| Manual sharing (LIST/PUB)             | Owner creates and saves a manual draft with actual image, confirms required fields and free whole-lot availability, previews, explicitly publishes; another session reads stable Supabase record after refresh  | Pass — one actual-photo resource saved privately, restored after reload, explicitly reviewed/published and discovered by a separate account                                           |
| Photo workflow (PHOTO-01–06)          | JPEG/PNG/WebP up to 10 MB; private direct upload; server content/dimension validation, orientation normalization and metadata stripping; <=2,048 px without enlargement; preview/replace/remove                 | Partial — actual WebP upload, private normalization/derivative and restored preview passed; complete format/replacement/failure matrix remains open                                   |
| Candidate review (SCAN-01–07)         | Live Gemini result with <=12 stable candidates; synchronized accessible boxes/list; rename/category/remove/select/add; invalid localization permits manual continuation; saved edits survive refresh and reruns | Partial — live identification, persisted rename/category/deselect/remove/manual addition, and only selected private drafts passed; accuracy and complete edge-case matrix remain open |
| Guidance (LIST-01–06; sections 8–9)   | 20–30 reviewed sources, indexed active corpus, provider document registry; one live supported claim with inspected source; no-evidence/failure paths; owner approval and revision invalidation                  | Not verified — app guidance is explicitly unavailable; File Search capability smoke with 4 starter entries is not the required reviewed corpus or publication workflow                |
| Atomic publication (PUB-01–04)        | Final public image/field preview; only selected valid drafts publish; all-or-none batch, retry returns same durable IDs; no duplicate candidate drafts                                                          | Partial — final explicit single-resource publication passed; all-or-none multi-resource and duplicate/retry gates require separate evidence                                           |
| Discovery (FIND-01–04)                | Database keyword search and combined category/area/availability filters in URL; newest first; stable 24-record pages; detail links; honest empty/error states; visible-screen refresh within 10 seconds         | Partial — live published-resource keyword search/detail and search→clear→Back input restoration passed; combined-filter/pagination/performance matrix remains open                    |
| Privacy and authorization             | Visitor/unrelated-user UI, API, database and Storage probes cannot read private inputs or attach foreign images; secrets absent from browser; approved derivatives use current visibility checks                | Partial — visitor request gate, hidden private pickup, and neutral completed detail passed in isolated browser context; full API/Storage matrix requires its separate evidence        |
| AI evaluation (section 15)            | Held-out >=20 photos with >=100 objects and 30 reference cases; raw counts, versions, latency and cost; RAG comparison; evaluated support and failure cases                                                     | Not verified                                                                                                                                                                          |
| Hosted demo evidence (sections 17–18) | HTTPS URL/build ID, live owner and seeker session evidence, publication IDs, model/prompt/corpus versions, mobile/keyboard QA, explicit sample labels                                                           | Partial — local production demo and mobile/keyboard evidence passed; HTTPS deployment and full PRD evaluation remain open                                                             |

## Complete P0 beyond shared discovery

These remain required even when the first milestone is demonstrated.

| Gate                                      | Required behavior and evidence                                                                                                                                                                      | Status                                                                                                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource management (PUB-05–07)           | Available edit/withdraw/republish, content revision changes, pending-request cancellation, reserved-edit rejection, completed history and deletion                                                  | Not verified                                                                                                                                                                                                     |
| Requests (REQ-01–06)                      | Whole listing, <=500-character note and pickup window; self/duplicate/stale request rejection; incoming/outgoing lists; owner accept/decline and participant cancellation                           | Partial — actual note/window, outgoing/incoming visibility and owner acceptance passed; decline/cancellation and invalid requests not exercised in this browser case                                             |
| Reservation integrity                     | Concurrent accepts select exactly one requester and decline other pending requests; cancel/withdraw/complete races leave consistent state; declined requests never reactivate automatically         | Not verified                                                                                                                                                                                                     |
| Pickup (PICKUP-01–06)                     | Private place/window/timezone; requester agreement/change request; arrangement revision invalidates old agreement; cancel revokes requester access immediately; owner-recorded completion is atomic | Partial — proposal, change request, revised window, agreement, simulated owner collection, terminal DB state and participant history after reload passed; cancellation access revocation needs its separate case |
| Reports and operator controls (MOD-01–03) | Private receipt, server-controlled operator authorization, audited hide/restore; hiding cancels requests; restore returns withdrawn for owner review                                                | Not verified                                                                                                                                                                                                     |
| Retention and deletion (section 12)       | Referenced assets preserved; orphan derivatives removed after 24 hours; eligible abandoned scans after 30 days; pickup details after 30 days; deletion leaves minimal participant history           | Not verified                                                                                                                                                                                                     |
| Operations (sections 13–15)               | Bounded deadlines/retries, quota enforcement, operator-set spend ceiling, safe logs, event plan and measured performance                                                                            | Not verified                                                                                                                                                                                                     |
| Pilot handoff (sections 19–20)            | Actual pilot area/operator, reviewed corpus/usage basis, provider account choices, privacy notice and account-deletion workflow; complete setup/evidence bundle                                     | Not verified                                                                                                                                                                                                     |

## Production browser evidence — September 12, 2026

**The implementation demo passes all four end-to-end scenarios. This does not establish complete PRD readiness.** The app ran in production mode at `http://localhost:3012` with hosted Supabase, build `dwzo2Wvvd0JMwlRCghV_2`. Two distinct confirmed accounts used the ordinary sign-in screen, and visitor checks used a third isolated browser context. Credentials remained in ignored fixtures; auth traces and automatic screenshots were disabled.

Exact results: [production test log](../output/qa/playwright-production.log), [structured summary](../output/qa/e2e-summary.json). **4 passed, 0 failed, 50.4 seconds total.**

| Case                                                      | Result and observed behavior                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Requests](../tests/e2e/requests.spec.ts)                 | **Pass, 15.2 seconds.** Seeker sends note/window; owner accepts; private meeting place/window/timezone saved; seeker requests a change; owner revises; seeker agrees. Owner explicitly confirms a simulated collection. Database reads verify `completed` / `fulfilled`; participant history survives reload. Visitor sees neither pickup details nor completed listing content. Requests fit 320px; no page errors observed. |
| [Live candidate review](../tests/e2e/scan-review.spec.ts) | **Pass, 16.4 seconds.** Actual licensed photo sent to Gemini after explicit consent. Five suggestions returned; owner corrections, deselection, removal and manual addition survive reload. Only the two selected items become corrected private drafts. [Case evidence](../output/qa/scan-review-ui.json).                                                                                                                   |
| [Manual sharing](../tests/e2e/share.spec.ts)              | **Pass, 11.8 seconds.** Actual WebP photo upload, private draft autosave and server acknowledgement, other-account private-draft denial, reload recovery, explicit image/field preview and publication. A separate signed-in account discovers the new resource by keyword search and reads its stable detail. Editor and detail fit 320px; no page errors observed.                                                          |
| [Responsive and keyboard](../tests/e2e/visual.spec.ts)    | **Pass, 3.7 seconds.** Signed-out desktop and 320px Explore and 320px Share fit the viewport. Skip link is hidden at rest and visible with Tab. Search→clear chip→browser Back restores the search input from the URL.                                                                                                                                                                                                        |

All temporary resource fixtures were removed. A post-run database check confirmed the six original labeled samples remain available and no non-seed owner resources remain. Test scan originals/normalized images, derivatives and private drafts are scoped to their own scan and cleaned in teardown hooks. Simulated collection is not a real physical handoff or inventory offer.

Visually inspected production screenshots:

- [Desktop Explore](../output/qa/explore-desktop.png), [320px Explore viewport](../output/qa/explore-320-viewport.png), [320px signed-out Share](../output/qa/share-signedout-320.png).
- [Restored private editor](../output/qa/share-restored-private-draft.png), [publication review](../output/qa/share-publication-review.png), [320px editor viewport](../output/qa/share-editor-320-viewport.png).
- [Second-account detail](../output/qa/share-second-account-discovery.png), [320px detail viewport](../output/qa/share-second-account-detail-320-viewport.png).
- [Private pickup proposal](../output/qa/owner-proposed-pickup.png), [agreed pickup](../output/qa/requester-agreed-pickup.png), [320px collected request viewport](../output/qa/requests-320-viewport.png).

The screens have readable field grouping, visible sample labeling and no horizontal overflow in the exercised 320px cases. Full-page captures show fixed mobile navigation at the original viewport boundary; use the viewport images to assess the actual initial screen.

Closed browser finding: initial Share editor area options were absent after a development effect cleanup. Independent area loading and corrected hydration bookkeeping were applied; the production manual-sharing case now selects an area, restores it and publishes successfully. Development runs interrupted by source reloads were superseded by the stable production run above. The hidden skip link appearing in earlier scrolled full-page captures was a screenshot artifact; actual keyboard/position assertions pass.

Supporting engineering evidence: [type/lint/unit/build record](../output/qa/validation.json), [live vision smoke](../output/qa/gemini-smoke.json), [photo pipeline/privacy checks](../output/qa/photo-pipeline-smoke.json), [File Search capability smoke](../output/qa/file-search-smoke.json). The recorded models are `gemini-3.5-flash` for image detection and `gemini-3.8-flash` for the File Search smoke. A single photo and a four-entry starter corpus do not satisfy held-out accuracy, source-review or grounded-guidance release gates.

Remaining release work includes the reviewed 20–30 source corpus and complete grounded-guidance/approval/revision flow; the required held-out photo/reference evaluation; hosted HTTPS account lifecycle testing; full moderation/operator and scheduled retention workflows; and remaining concurrency, failure, combined-filter/pagination and measured performance cases. Consult the gate tables rather than treating the passing demo as full P0 acceptance.

## Constraints to preserve during implementation

1. Uploading, analysis, draft saves and selection never publish. “Saved” requires server acknowledgement; navigation with a pending save offers retry or explicit discard.
2. Published fields are owner-reviewed facts or explicit unknowns. Separate observations, owner statements and reference guidance. No photo-based certification of composition, safety, strength, condition or value.
3. Both originals and approved derivatives remain in private buckets. A server image endpoint checks current access before issuing a short-lived URL (proposed five minutes). Withdrawal stops new issuance; existing URLs can remain usable until expiry.
4. Public image approval must show background exposure. Provide ordinary crop controls or an uncropped option that is usable without dragging, plus editable alt text. Generated replacement listing photos are prohibited.
5. Every saved content change increments the resource revision, hides stale guidance and cancels pending requests. Availability transitions preserve that revision. Reserved content cannot change until cancellation.
6. Public resource rows contain no pickup details, Auth email or raw provider data. RLS alone does not hide sensitive columns. Direct client state/evidence/ownership writes require restricted grants and validated commands.
7. Gemini boxes arrive as `[y_min, x_min, y_max, x_max]` on a 0–1000 scale. One tested adapter produces named coordinates; do not silently swap axes. Preserve valid identity data when a box is invalid.
8. Source identity comes from provider annotations joined to an active document/version registry, not model-written URLs or duplicate display titles. Each claim binds to its exact item and input revision. Withdrawn sources suppress existing public claims.
9. The entire object or named lot transfers to one requester. Exactly one accepted request implies reserved; available implies none. Commands are actor-scoped, payload-bound and idempotent for at least 24 hours.
10. No precise location permission, unsupported distance labels, fabricated neighbors/activity, live-AI labels on recorded results, or unsupported impact claims.

## Proposed evaluation thresholds (not measured results)

| Evaluation              | PRD target                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detection               | >=90% precision and >=80% recall on >=20 held-out photos / >=100 in-scope objects                                                                                       |
| Localization            | >=90% of correct detections have bounding-box IoU >=0.5                                                                                                                 |
| Reference cases         | 30 cases including >=5 no-evidence, >=5 ambiguous and >=3 conflicting/withdrawn cases; categories may overlap                                                           |
| Claim support           | >=95% reviewer-assessed support, every displayed claim resolves to an active source; unsafe or unsupported item-specific properties block release regardless of average |
| RAG comparison          | Recorded support/relevance improvement over no-RAG using the same facts/settings, with no increase in unsupported claims                                                |
| Read latency            | Explore/detail p95 <=2 seconds at 1,000 seeded records and 10 concurrent sessions under recorded network conditions                                                     |
| Detection latency       | Usable review p95 <=20 seconds; application deadline 30 seconds                                                                                                         |
| Cross-session freshness | Committed mutations reflected within 10 seconds on visible discovery/request screens, or immediately after explicit refresh                                             |
| Integrity               | Zero duplicate publications, double reservations or unauthorized private-data reads in exercised tests                                                                  |

## Initial local feasibility snapshot

Read-only inspection on September 12, 2026 found Node/npm, pnpm, Supabase CLI 2.106.0, Docker CLI and bundled PDF tooling. Docker did not respond to `docker info` because its daemon was unavailable. This is a local-service observation, not a conclusion that hosted Supabase is unavailable. No `AGENTS.md` was found in the workspace or its checked ancestor directories.

Supabase project credentials, configured Auth delivery, verified test accounts, Gemini credentials/account capabilities, active File Search store, deployment access and approved corpus status were **unknown in this inspection**. Never convert unknown into configured or blocked without checking the relevant prerequisite. Later verified evidence supersedes this snapshot.

## Evidence record template

```text
Gate / case ID:
Date and tester:
Build / commit:
Environment URL:
User roles (no credentials):
Prerequisites:
Steps performed:
Expected result:
Observed result:
Outcome: Pass / Fail / Blocked
Safe evidence paths or IDs:
Remaining limitation:
```

Run procedures: [demo-runbook.md](demo-runbook.md). Keep failed findings in this ledger until the same case has been retested against the fix.
