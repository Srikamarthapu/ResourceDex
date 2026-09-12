import { describe, expect, it } from 'vitest';
import { fromGeminiBox, parseDetections } from '../src/lib/ai/detection';
import { cropPixels, projectBounds } from '../src/lib/images/geometry';

const candidate = {
  candidate_key: 'a',
  label: 'Metal bracket',
  category: 'hardware',
  box_2d: [100, 250, 600, 750],
  visible_observations: ['Two visible holes.'],
  unknowns: ['Exact metal type unknown.'],
  owner_questions: ['Are any edges sharp?'],
};

describe('the Gemini coordinate adapter', () => {
  it('explicitly converts y/x to named x/y without swapping to fix invalid boxes', () => {
    expect(fromGeminiBox([100, 250, 600, 750])).toEqual({
      x_min: 250,
      y_min: 100,
      x_max: 750,
      y_max: 600,
    });
    expect(fromGeminiBox([600, 250, 100, 750])).toBeNull();
  });
  it.each([
    null,
    [],
    [0, 0, 0, 2],
    [0, 4, 9, 4],
    [-1, 0, 100, 100],
    [0, 0, 1001, 100],
    [0, 0, NaN, 100],
    [0, 0, 12.5, 100],
    ['0', 0, 100, 100],
  ])('rejects invalid localization %j', (box) => {
    expect(fromGeminiBox(box)).toBeNull();
  });
  it('retains an explicitly unlocalized candidate when its other fields validate', () => {
    const result = parseDetections(
      JSON.stringify({ candidates: [{ ...candidate, box_2d: null }] }),
      'run-1',
    );
    expect(result.candidates[0]).toMatchObject({
      candidate_id: 'run-1:a',
      bounds: null,
      localization_status: 'invalid_ai_box',
      review_status: 'pending',
    });
  });
  it('rejects duplicate keys, unknown categories, malformed output, and excess candidates', () => {
    expect(() =>
      parseDetections(JSON.stringify({ candidates: [candidate, candidate] }), 'run'),
    ).toThrow();
    expect(() =>
      parseDetections(
        JSON.stringify({
          candidates: [{ ...candidate, category: 'chemicals' }],
        }),
        'run',
      ),
    ).toThrow();
    expect(() => parseDetections('not json', 'run')).toThrow();
    expect(() =>
      parseDetections(
        JSON.stringify({
          candidates: Array.from({ length: 13 }, (_, i) => ({
            ...candidate,
            candidate_key: String(i),
          })),
        }),
        'run',
      ),
    ).toThrow();
  });
  it('allows no clear items and signals an incomplete result at the cap', () => {
    expect(parseDetections('{"candidates":[]}', 'run')).toEqual({
      candidates: [],
      limitReached: false,
    });
    expect(
      parseDetections(
        JSON.stringify({
          candidates: Array.from({ length: 12 }, (_, i) => ({
            ...candidate,
            candidate_key: String(i),
          })),
        }),
        'run',
      ).limitReached,
    ).toBe(true);
  });
});

describe('image-to-screen geometry', () => {
  const bounds = { x_min: 250, y_min: 100, x_max: 750, y_max: 600 };
  it('accounts for landscape letterboxing', () => {
    expect(
      projectBounds(bounds, { width: 2000, height: 1000 }, { width: 400, height: 400 }),
    ).toEqual({ left: 100, top: 120, width: 200, height: 100 });
  });
  it('accounts for portrait letterboxing and narrow mobile displays', () => {
    expect(
      projectBounds(bounds, { width: 1000, height: 2000 }, { width: 320, height: 320 }),
    ).toEqual({ left: 120, top: 32, width: 80, height: 160 });
  });
  it('accounts for cover cropping', () => {
    expect(
      projectBounds(bounds, { width: 2000, height: 1000 }, { width: 400, height: 400 }, 'cover'),
    ).toEqual({ left: 0, top: 40, width: 400, height: 200 });
  });
  it('uses normalized post-rotation dimensions and rounds an inclusive crop safely', () => {
    expect(
      projectBounds(bounds, { width: 600, height: 1200 }, { width: 300, height: 600 }),
    ).toEqual({ left: 75, top: 60, width: 150, height: 300 });
    expect(
      cropPixels({ x_min: 0, y_min: 0, x_max: 1000, y_max: 1000 }, { width: 101, height: 203 }),
    ).toEqual({ left: 0, top: 0, width: 101, height: 203 });
    expect(() =>
      projectBounds(bounds, { width: 0, height: 200 }, { width: 320, height: 320 }),
    ).toThrow();
  });
});
