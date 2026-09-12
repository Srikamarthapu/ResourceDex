import { z } from 'zod';
import { categories } from '../types';
import type { DetectionCandidate } from './detection';

export const candidateReviewSchema = z
  .object({
    analysisVersion: z.number().int().positive(),
    expectedReviewVersion: z.number().int().min(0),
    candidates: z
      .array(
        z
          .object({
            candidateId: z.string().min(1).max(160),
            // An unfinished owner edit is still a valid private draft.
            label: z.string().trim().max(80),
            category: z.enum(categories),
            selected: z.boolean(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export type CandidateReviewInput = z.infer<typeof candidateReviewSchema>;

/** Preserve source observations and localization. Only explicit owner edits may
 * replace suggestions; removed originals stay in the private review snapshot. */
export function applyCandidateReview(
  original: DetectionCandidate[],
  edits: CandidateReviewInput['candidates'],
): DetectionCandidate[] {
  const originals = new Set(original.map((candidate) => candidate.candidate_id));
  const edited = new Map(edits.map((candidate) => [candidate.candidateId, candidate]));
  const manualEdits = edits.filter((candidate) => !originals.has(candidate.candidateId));
  if (
    edited.size !== edits.length ||
    manualEdits.some(
      (candidate) =>
        !candidate.candidateId.startsWith('manual:') ||
        !z.string().uuid().safeParse(candidate.candidateId.slice(7)).success,
    )
  ) {
    throw new Error('The review contains duplicate or unknown item identifiers.');
  }
  const reviewed: DetectionCandidate[] = original.map((candidate) => {
    const edit = edited.get(candidate.candidate_id);
    if (!edit) return { ...candidate, selected: false, review_status: 'removed' };
    return {
      ...candidate,
      label: edit.label,
      category: edit.category,
      selected: edit.selected,
      review_status:
        edit.label !== candidate.label || edit.category !== candidate.category
          ? 'corrected'
          : 'pending',
    };
  });
  return reviewed.concat(
    manualEdits.map((candidate) => ({
      candidate_id: candidate.candidateId,
      label: candidate.label,
      category: candidate.category,
      selected: candidate.selected,
      bounds: null,
      localization_status: 'manual_unlocalized',
      localization_reason: 'Added by you. Choose an approved photo or crop.',
      visible_observations: [],
      unknowns: ['Material, dimensions and condition have not been confirmed.'],
      owner_questions: [],
      review_status: 'corrected',
      source: 'manual',
    })),
  );
}
