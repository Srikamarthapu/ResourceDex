import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalysisProgress } from '../src/components/analysis-progress';
import type { AnalysisState } from '../src/lib/scan-analysis';

const initial: AnalysisState = {
  active: { scanId: 'scan', operationKey: 'attempt', startedAt: null, deadlineAt: null },
  phase: 'running',
  checking: false,
  confirmed: false,
  otherPhoto: false,
  message: '',
  resultScanId: null,
  progress: null,
  outcome: null,
};
const render = (patch: Partial<AnalysisState> = {}) =>
  renderToStaticMarkup(
    createElement(AnalysisProgress, {
      state: { ...initial, ...patch },
      elapsedSeconds: 42,
      onStop: () => {},
      onCheck: () => {},
    }),
  );
const progress: NonNullable<AnalysisState['progress']> = {
  model: 'moonshotai/kimi-k3',
  phase: 'references',
  fallbacks: [
    { from: 'gemini-3.5-flash', to: 'gemini-3.8-flash', reason: 'rate_limit' },
    { from: 'gemini-3.8-flash', to: 'moonshotai/kimi-k3', reason: 'timeout' },
  ],
};

describe('identification model status', () => {
  it('shows Starting without inventing a model before saved progress is known', () => {
    const html = render();
    expect(html).toContain('Starting…');
    expect(html).not.toContain('Using Gemini');
    expect(html).toContain('disabled=""');
  });

  it.each([
    ['gemini-3.5-flash', 'Gemini 3.5 Flash'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
    ['moonshotai/kimi-k3', 'Kimi K3'],
  ])('names the actual persisted model %s', (model, label) => {
    const html = render({
      confirmed: true,
      progress: { model, phase: 'identifying', fallbacks: [] },
    });
    expect(html).toContain(`Using ${label}`);
    expect(html).toContain('Stop identification');
    expect(html).toContain('Check status');
  });

  it('distinguishes reference checking and explains each of the two fallbacks', () => {
    const html = render({ confirmed: true, progress });
    expect(html).toContain('Kimi K3 is checking references');
    expect(html).toContain('Gemini 3.5 Flash hit a rate limit → switched to Gemini 3.8 Flash.');
    expect(html).toContain('Gemini 3.8 Flash timed out → switched to Kimi K3.');
    expect(html).not.toContain('Identifying your photo');
  });

  it('retains a successful finished model after the active attempt clears', () => {
    const html = render({ active: null, phase: 'idle', progress, outcome: 'completed' });
    expect(html).toContain('Identification finished with Kimi K3');
    expect(html).not.toContain('Starting');
    expect(html).not.toContain('Stop identification');
  });

  it('describes cancellation without claiming the model finished', () => {
    const html = render({
      active: null,
      phase: 'idle',
      progress,
      outcome: 'stopped',
      message: 'Identification stopped.',
    });
    expect(html).toContain('Stopped while using Kimi K3');
    expect(html).not.toContain('finished with');
    expect(html).not.toContain('checking references');
  });
});
