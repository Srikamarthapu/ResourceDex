import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import manifest from '../../../knowledge/starter-corpus.json';
import { categories, type Category } from '../types';
import type { ReferenceNote } from './reference-types';

export const REFERENCE_RETRIEVAL_VERSION = 'local-reference-v1';
const MAX_REVIEW_AGE_DAYS = 365;

const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3).max(180),
  publisher: z.string().min(3).max(180),
  url: z.url().startsWith('https://'),
  locator: z.string().min(1).max(240),
  reviewedAt: z.iso.date(),
  reviewedBy: z.string().min(3),
  usageBasis: z.string().min(20),
  categories: z.array(z.enum(categories)).min(1),
  active: z.boolean(),
  text: z.string().min(20).max(500),
  applicability: z.string().min(20).max(700),
});
const corpusSchema = z.object({
  version: z.string().min(1),
  status: z.literal('reviewed_for_capability_test'),
  limitations: z.string().min(1),
  entries: z.array(entrySchema).min(1).max(30),
});

export type ReferenceEntry = z.infer<typeof entrySchema>;
export type ReferenceCorpus = z.infer<typeof corpusSchema>;
export type ReferenceSource = Pick<
  ReferenceEntry,
  'id' | 'title' | 'publisher' | 'url' | 'locator' | 'reviewedAt' | 'text' | 'applicability'
> & { contentHash: string };
export type ReferenceQuery = {
  label: string;
  category: Category;
  material?: string;
  description?: string;
};
export type RetrievedReferences = {
  status: 'retrieved' | 'no_evidence';
  retrievalVersion: typeof REFERENCE_RETRIEVAL_VERSION;
  corpusVersion: string;
  queryHash: string;
  limitations: string;
  sources: ReferenceSource[];
};

const corpus = corpusSchema.parse(manifest);
if (new Set(corpus.entries.map((entry) => entry.id)).size !== corpus.entries.length)
  throw new Error('The reference corpus contains duplicate source IDs.');

const ignoredWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'with',
  'unknown',
  'item',
  'items',
  'material',
  'materials',
  'photo',
  'some',
  'one',
  'lot',
]);
function tokens(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (word) => word.length > 2 && !ignoredWords.has(word),
    ),
  );
}
function hash(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

/** Matches the canonical content used by the File Search ingestion script. */
function sourceHash(entry: ReferenceEntry) {
  return hash(
    `Source ID: ${entry.id}\nTitle: ${entry.title}\nPublisher: ${entry.publisher}\nCanonical source: ${entry.url}\nSection: ${entry.locator}\nReference guidance: ${entry.text}\nConditions and limitations: ${entry.applicability}\n`,
  );
}
function isCurrent(entry: ReferenceEntry, now: Date) {
  const age = (now.getTime() - Date.parse(`${entry.reviewedAt}T00:00:00Z`)) / 86_400_000;
  return entry.active && age >= 0 && age <= MAX_REVIEW_AGE_DAYS;
}
function safeSource(entry: ReferenceEntry): ReferenceSource {
  return {
    id: entry.id,
    title: entry.title,
    publisher: entry.publisher,
    url: entry.url,
    locator: entry.locator,
    reviewedAt: entry.reviewedAt,
    text: entry.text,
    applicability: entry.applicability,
    contentHash: sourceHash(entry),
  };
}

/** Query-specific retrieval from the reviewed local collection. No provider,
 * web request, user listing, or model-authored document participates in search. */
export function retrieveReferenceContext(
  input: ReferenceQuery,
  options: { corpus?: ReferenceCorpus; now?: Date; limit?: number } = {},
): RetrievedReferences {
  const activeCorpus = options.corpus ?? corpus;
  const now = options.now ?? new Date();
  const query = {
    label: input.label.trim().slice(0, 80),
    category: input.category,
    material: input.material?.trim().slice(0, 100) || 'Unknown',
    description: input.description?.trim().slice(0, 1000) || '',
  };
  const words = tokens(`${query.label} ${query.material} ${query.description}`);
  const limit = Math.max(1, Math.min(3, Math.floor(options.limit ?? 2)));
  const sources =
    !query.label || !categories.includes(query.category)
      ? []
      : activeCorpus.entries
          .filter((entry) => isCurrent(entry, now) && entry.categories.includes(query.category))
          .map((entry) => {
            const titleWords = tokens(entry.title);
            const contentWords = tokens(`${entry.text} ${entry.applicability}`);
            // A matching reviewed category permits conditional general reuse guidance;
            // lexical overlap ranks more specific references ahead of general options.
            const score = [...words].reduce(
              (total, word) =>
                total + (titleWords.has(word) ? 3 : 0) + (contentWords.has(word) ? 1 : 0),
              1,
            );
            return { entry, score };
          })
          .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
          .slice(0, limit)
          .map(({ entry }) => safeSource(entry));
  return {
    status: sources.length ? 'retrieved' : 'no_evidence',
    retrievalVersion: REFERENCE_RETRIEVAL_VERSION,
    corpusVersion: activeCorpus.version,
    queryHash: hash(JSON.stringify(query)),
    limitations: activeCorpus.limitations,
    sources,
  };
}

/** Resolve model-selected IDs against the actual retrieved set and the current
 * active corpus. URLs, quotations and factual claims are never taken from a model. */
export function resolveReferenceSelection(
  retrieved: RetrievedReferences,
  sourceIds: string[],
  options: { corpus?: ReferenceCorpus; now?: Date } = {},
): ReferenceSource[] {
  const activeCorpus = options.corpus ?? corpus;
  if (retrieved.corpusVersion !== activeCorpus.version) return [];
  const now = options.now ?? new Date();
  return [...new Set(sourceIds)].slice(0, 3).flatMap((id) => {
    const evidence = retrieved.sources.find((source) => source.id === id);
    const current = activeCorpus.entries.find((entry) => entry.id === id);
    return evidence &&
      current &&
      isCurrent(current, now) &&
      evidence.contentHash === sourceHash(current)
      ? [safeSource(current)]
      : [];
  });
}

/** Recheck stored private notes on every read so source withdrawal, edits, or an
 * expired review suppress old guidance without rewriting the image evidence. */
export function currentReferenceNotes(
  notes: ReferenceNote[] | undefined,
  options: { corpus?: ReferenceCorpus; now?: Date } = {},
): ReferenceNote[] {
  const activeCorpus = options.corpus ?? corpus;
  const now = options.now ?? new Date();
  return (notes ?? []).flatMap((note) => {
    const source = activeCorpus.entries.find((entry) => entry.id === note.source.id);
    const valid =
      source &&
      isCurrent(source, now) &&
      note.source.corpusVersion === activeCorpus.version &&
      note.source.contentHash === sourceHash(source) &&
      note.text === source.text &&
      note.applicability === source.applicability;
    return valid
      ? [
          {
            text: source.text,
            applicability: source.applicability,
            source: {
              id: source.id,
              title: source.title,
              publisher: source.publisher,
              url: source.url,
              locator: source.locator,
              contentHash: sourceHash(source),
              corpusVersion: activeCorpus.version,
            },
          },
        ]
      : [];
  });
}
