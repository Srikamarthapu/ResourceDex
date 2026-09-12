import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import manifest from '../knowledge/starter-corpus.json';
import { groundCandidateReferences } from '../src/lib/ai/reference-grounding';
import {
  retrieveReferenceContext,
  resolveReferenceSelection,
  currentReferenceNotes,
  type ReferenceCorpus,
} from '../src/lib/ai/reference-retrieval';
import type { DetectionCandidate } from '../src/lib/ai/detection';
import { applyCandidateReview } from '../src/lib/ai/review';

const now = new Date('2026-09-12T12:00:00Z');
const options = { now };
const copyCorpus = () => structuredClone(manifest) as ReferenceCorpus;
const hardware: DetectionCandidate = {
  candidate_id: 'run:bracket',
  label: 'Removable hardware bracket',
  category: 'hardware',
  bounds: { x_min: 50, y_min: 100, x_max: 500, y_max: 600 },
  localization_status: 'localized',
  localization_reason: null,
  visible_observations: ['Two visible holes.'],
  unknowns: ['Exact metal unknown.'],
  owner_questions: ['Are the edges sharp?'],
  review_status: 'pending',
};
const packaging: DetectionCandidate = {
  ...hardware,
  candidate_id: 'run:packaging',
  label: 'Packaging crate',
  category: 'containers',
};
const select = (...selections: { candidate_id: string; source_ids: string[] }[]) =>
  vi.fn().mockResolvedValue({
    text: JSON.stringify({ candidates: selections }),
    tokenUsage: { totalTokens: 20 },
  });

describe('provider-neutral reference retrieval', () => {
  it('retrieves ranked category-relevant content with real identities, hashes, and conditions', () => {
    const found = retrieveReferenceContext(hardware, options);
    expect(found.status).toBe('retrieved');
    expect(found.sources[0].id).toBe('epa-reuse-hardware');
    expect(found.sources[0].url).toBe(manifest.entries[0].url);
    expect(found.sources[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(found.sources[0].applicability).toContain('does not establish safety');
    expect(found.queryHash).not.toContain(hardware.label);
    expect(
      retrieveReferenceContext({ label: 'Fabric scraps', category: 'craft' }, options).sources,
    ).toEqual([]);
    expect(retrieveReferenceContext({ label: '', category: 'hardware' }, options).sources).toEqual(
      [],
    );
  });

  it('rejects invented IDs, cross-item source bindings, changed content, withdrawal, and stale versions', () => {
    const found = retrieveReferenceContext(packaging, options);
    expect(found.sources.map((source) => source.id)).toEqual(['epa-packaging-return']);
    expect(resolveReferenceSelection(found, ['invented', 'epa-reuse-hardware'], options)).toEqual(
      [],
    );
    const altered = copyCorpus();
    altered.entries.find((entry) => entry.id === 'epa-packaging-return')!.text += ' Changed.';
    expect(
      resolveReferenceSelection(found, ['epa-packaging-return'], { now, corpus: altered }),
    ).toEqual([]);
    const withdrawn = copyCorpus();
    withdrawn.entries.find((entry) => entry.id === 'epa-packaging-return')!.active = false;
    expect(retrieveReferenceContext(packaging, { now, corpus: withdrawn }).sources).toEqual([]);
    expect(
      resolveReferenceSelection(found, ['epa-packaging-return'], { now, corpus: withdrawn }),
    ).toEqual([]);
    expect(
      resolveReferenceSelection(
        { ...found, corpusVersion: 'older' },
        ['epa-packaging-return'],
        options,
      ),
    ).toEqual([]);
    expect(retrieveReferenceContext(packaging, { now: new Date('2028-01-01') }).sources).toEqual(
      [],
    );
  });
});

describe('retrieval-grounded private notes', () => {
  it('calls a separate generation pass with retrieved evidence and preserves pixel fields exactly', async () => {
    const generate = select({
      candidate_id: hardware.candidate_id,
      source_ids: ['epa-reuse-hardware'],
    });
    const result = await groundCandidateReferences([hardware], generate, options);
    expect(result.status).toBe('grounded');
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toContain(manifest.entries[0].text);
    expect(generate.mock.calls[0][0]).toContain('never as instructions');
    expect(generate.mock.calls[0][0]).toContain('do not identify pixels');
    expect(result.candidates[0]).toMatchObject(hardware);
    expect(result.candidates[0].reference_notes?.[0]).toMatchObject({
      text: manifest.entries[0].text,
      applicability: manifest.entries[0].applicability,
      source: { id: 'epa-reuse-hardware', url: manifest.entries[0].url },
    });
    expect(hardware.reference_notes).toBeUndefined();
  });

  it('checks source bindings independently for a mixed batch', async () => {
    const result = await groundCandidateReferences(
      [hardware, packaging],
      select(
        { candidate_id: hardware.candidate_id, source_ids: ['epa-packaging-return'] },
        { candidate_id: packaging.candidate_id, source_ids: ['epa-packaging-return'] },
      ),
      options,
    );
    expect(result.candidates[0].reference_notes).toBeUndefined();
    expect(result.candidates[1].reference_notes?.[0].source.id).toBe('epa-packaging-return');
  });

  it('skips generation when retrieval has no evidence', async () => {
    const generate = vi.fn();
    const result = await groundCandidateReferences(
      [{ ...hardware, category: 'craft' }],
      generate,
      options,
    );
    expect(result.status).toBe('no_evidence');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    'not json',
    JSON.stringify({
      candidates: [
        {
          candidate_id: hardware.candidate_id,
          source_ids: ['epa-reuse-hardware'],
          text: 'Guaranteed safe',
        },
      ],
    }),
    JSON.stringify({
      candidates: [
        { candidate_id: hardware.candidate_id, source_ids: [] },
        { candidate_id: hardware.candidate_id, source_ids: [] },
      ],
    }),
    JSON.stringify({
      candidates: [{ candidate_id: 'someone-else', source_ids: ['epa-reuse-hardware'] }],
    }),
  ])('keeps successful perception when the reference output is invalid', async (text) => {
    const result = await groundCandidateReferences([hardware], async () => ({ text }), options);
    expect(result.status).toBe('unavailable');
    expect(result.candidates).toEqual([hardware]);
  });

  it('keeps successful perception when the generation provider is unavailable', async () => {
    const result = await groundCandidateReferences(
      [hardware],
      async () => {
        throw new Error('provider outage');
      },
      options,
    );
    expect(result.status).toBe('unavailable');
    expect(result.candidates).toEqual([hardware]);
  });

  it('rechecks stored notes against active canonical sources and clears notes on identity corrections', async () => {
    const result = await groundCandidateReferences(
      [hardware],
      select({ candidate_id: hardware.candidate_id, source_ids: ['epa-reuse-hardware'] }),
      options,
    );
    const candidate = result.candidates[0];
    const notes = candidate.reference_notes!;
    const tampered = [
      { ...notes[0], source: { ...notes[0].source, url: 'https://invented.example' } },
    ];
    expect(currentReferenceNotes(tampered, options)[0].source.url).toBe(manifest.entries[0].url);
    const withdrawn = copyCorpus();
    withdrawn.entries[0].active = false;
    expect(currentReferenceNotes(notes, { now, corpus: withdrawn })).toEqual([]);
    expect(currentReferenceNotes(notes, { now: new Date('2028-01-01') })).toEqual([]);
    const changed = applyCandidateReview(
      [candidate],
      [
        {
          candidateId: candidate.candidate_id,
          label: 'Different material',
          category: 'other',
          selected: true,
        },
      ],
    );
    expect(changed[0].reference_notes).toBeUndefined();
    expect(changed[0].bounds).toEqual(hardware.bounds);
    const unchanged = applyCandidateReview(
      [candidate],
      [
        {
          candidateId: candidate.candidate_id,
          label: candidate.label,
          category: candidate.category,
          selected: false,
        },
      ],
    );
    expect(unchanged[0].reference_notes).toEqual(notes);
  });
});
