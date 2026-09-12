# Private reuse reference notes

The backup-provider path can run genuine retrieval before its reference generation pass without depending on Gemini File Search. `reference-retrieval.ts` searches the bundled `knowledge/starter-corpus.json`; `reference-grounding.ts` sends the retrieved passages, their applicability conditions, and per-item source allowlists to a separate provider call. The vision result remains independent.

The current collection has four implementation-reviewed entries from [EPA's construction-material reuse guidance](https://www.epa.gov/smm/sustainable-management-construction-and-demolition-materials) and [Habitat for Humanity's donation guidance](https://www.habitat.org/restores/donate-goods). The canonical pages were checked on September 12, 2026. This is limited starter coverage, not the PRD's 20–30-entry reviewed pilot corpus or evidence of retrieval accuracy.

## Retrieval and evidence boundaries

- Query fields are the candidate label, category, and visible description. Known material can also be supplied to the retrieval helper; unknown material remains explicit. Private account, address, pickup, and contact fields are never query inputs.
- Retrieval filters to active, matching-category entries reviewed within the last 365 days. Within that set, lexical overlap in titles and content ranks specific passages above general donation options. At most two references per candidate enter the grounding pass. Categories without coverage return no evidence.
- This is deterministic local lexical retrieval, not vector search or a live web search. Bundling this small versioned collection makes retrieval available even when Gemini is rate-limited. Existing File Search ingestion remains an independent capability test; runtime fallback does not rely on its provider store.
- Generation may select or omit source IDs only. The server resolves each selection against that item's actual retrieved set and the current corpus. It returns the corpus's exact concise paraphrase and applicability conditions; model-authored claims, quotations, links, and IDs cannot become displayed evidence.
- Canonical IDs, content hashes, section locators, and corpus versions accompany each note. The content hash matches the File Search ingestion content format. Unknown IDs, incorrect item bindings, changed content, withdrawn entries, and expired reviews are rejected. Duplicate candidate IDs or malformed provider output discard reference notes while preserving valid perception.
- `reference_notes` remain separate from `visible_observations`, labels, categories, and bounding boxes. They are private review context and are not copied into resource descriptions or published as listing claims. Owner changes to an item's label or category clear its previous notes.
- Recheck stored notes through `currentReferenceNotes` before returning them. Source withdrawal or a changed corpus version suppresses old notes on subsequent reads. Withdrawals require updating the bundled manifest and deploying it; there is no live operator withdrawal dashboard yet.

## Provider integration

`groundCandidateReferences(candidates, generate)` accepts a provider-neutral callback:

```ts
(prompt: string, jsonSchema: Record<string, unknown>) =>
  Promise<{ text: string; tokenUsage?: unknown }>
```

The caller owns the provider deadline, credentials, and spend accounting. The helper returns candidates with optional private notes, a `grounded`, `no_evidence`, or `unavailable` status, retrieval/corpus versions, selected source IDs, and provider token usage when supplied. A failed reference pass never discards a successful photo result. `ReferenceNotes` displays the conditions and canonical links without claiming that a citation verifies an item.

## Verification and remaining scope

`tests/reference-grounding.test.ts` covers real corpus retrieval, ranking and no-evidence behavior, source/content/version withdrawal, mixed-item source bindings, invented facts/IDs, malformed responses, provider failure, canonical URL resolution, unchanged image evidence, and invalidation after owner corrections. Mocked provider selections test the contract, not provider quality.

The full PRD still requires a larger reviewed collection, owner-confirmed-fact guidance, immutable claim/revision evidence tables, public approval and withdrawal behavior, and a measured with/without-RAG evaluation. Do not describe these private starter notes as completing those deliverables or improving image recognition accuracy.
