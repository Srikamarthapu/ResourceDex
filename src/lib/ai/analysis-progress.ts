import { z } from 'zod';

// Only app-generated status is exposed. Provider error bodies and reasoning
// never become progress text or leave the server.
export const analysisProgressSchema = z.object({
  model: z.string().min(1).max(120),
  phase: z.enum(['identifying', 'references']),
  fallbacks: z
    .array(
      z.object({
        from: z.string().min(1).max(120),
        to: z.string().min(1).max(120),
        reason: z.enum(['rate_limit', 'timeout', 'unavailable', 'not_configured']),
      }),
    )
    .max(2),
});

export type AnalysisProgress = z.infer<typeof analysisProgressSchema>;

export function readAnalysisProgress(value: unknown): AnalysisProgress | null {
  const parsed = analysisProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
