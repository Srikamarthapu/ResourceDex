import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientId } from '../src/lib/client-id';

afterEach(() => vi.unstubAllGlobals());

describe('browser operation IDs', () => {
  it('uses native UUID generation with its Crypto receiver intact', () => {
    const expected = '08cb42b3-5ef1-42db-8214-83e2f23c274b';
    const browserCrypto = {
      randomUUID() {
        expect(this).toBe(browserCrypto);
        return expected;
      },
      getRandomValues: vi.fn(),
    };
    vi.stubGlobal('crypto', browserCrypto);
    expect(createClientId()).toBe(expected);
    expect(browserCrypto.getRandomValues).not.toHaveBeenCalled();
  });

  it.each([
    [0x00, '00000000-0000-4000-8000-000000000000'],
    [0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ])('keeps UUID v4 version and variant for random byte %i', (byte, expected) => {
    const browserCrypto = {
      getRandomValues(values: Uint8Array) {
        expect(this).toBe(browserCrypto);
        expect(values).toHaveLength(16);
        return values.fill(byte);
      },
    };
    vi.stubGlobal('crypto', browserCrypto);
    expect(createClientId()).toBe(expected);
  });

  it('creates distinct database-compatible IDs without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const ids = Array.from({ length: 100 }, () => createClientId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it.each([undefined, {}])('reports unsupported secure randomness clearly', (browserCrypto) => {
    vi.stubGlobal('crypto', browserCrypto);
    expect(createClientId).toThrow('This browser cannot create secure IDs.');
  });
});
