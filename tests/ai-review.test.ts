import { describe, expect, it } from 'vitest';
import { applyCandidateReview, candidateReviewSchema } from '../src/lib/ai/review';
import type { DetectionCandidate } from '../src/lib/ai/detection';

const original: DetectionCandidate = {
  candidate_id: 'run:pliers',
  label: 'Pliers',
  category: 'tools',
  bounds: { x_min: 10, y_min: 20, x_max: 300, y_max: 600 },
  localization_status: 'localized',
  localization_reason: null,
  visible_observations: ['Two handles'],
  unknowns: ['Working condition'],
  owner_questions: [],
  review_status: 'pending',
};
const edit = {
  candidateId: original.candidate_id,
  label: 'Small pliers',
  category: 'tools' as const,
  selected: false,
};

describe('versioned owner candidate review', () => {
  it('adds manual items with explicit owner provenance and no invented localization', () => {
    const manual = {
      candidateId: 'manual:69193b5d-f2a8-4ee7-bc52-f943d191d758',
      label: 'Missed item',
      category: 'other' as const,
      selected: true,
    };
    const reviewed = applyCandidateReview([original], [edit, manual]);
    expect(reviewed).toHaveLength(2);
    expect(reviewed[1]).toMatchObject({
      candidate_id: manual.candidateId,
      source: 'manual',
      localization_status: 'manual_unlocalized',
      bounds: null,
      visible_observations: [],
      selected: true,
    });
    expect(() =>
      applyCandidateReview([original], [{ ...manual, candidateId: 'manual:made-up-id' }]),
    ).toThrow();
  });
  it('persists selection and corrected labels without changing image evidence', () => {
    const reviewed = applyCandidateReview([original], [edit]);
    expect(reviewed[0]).toMatchObject({
      label: 'Small pliers',
      selected: false,
      review_status: 'corrected',
      bounds: original.bounds,
      visible_observations: original.visible_observations,
    });
    expect(original.label).toBe('Pliers');
  });
  it('retains removed candidates privately and permits unfinished labels', () => {
    expect(applyCandidateReview([original], [])[0]).toMatchObject({
      selected: false,
      review_status: 'removed',
    });
    expect(
      candidateReviewSchema.safeParse({
        analysisVersion: 1,
        expectedReviewVersion: 0,
        candidates: [{ ...edit, label: '' }],
      }).success,
    ).toBe(true);
  });
  it('rejects duplicate IDs, foreign IDs and attempted evidence replacement', () => {
    expect(() => applyCandidateReview([original], [edit, edit])).toThrow();
    expect(() =>
      applyCandidateReview([original], [{ ...edit, candidateId: 'other:pliers' }]),
    ).toThrow();
    expect(
      candidateReviewSchema.safeParse({
        analysisVersion: 1,
        expectedReviewVersion: 0,
        candidates: [{ ...edit, visible_observations: ['Invented fact'] }],
      }).success,
    ).toBe(false);
  });
});
