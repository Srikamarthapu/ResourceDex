import { describe, expect, it } from 'vitest';
import { hasValidRequestOrigin } from '../src/lib/ai/request-origin';

describe('browser mutation origin validation', () => {
  it('uses the real request host when Next reports its bind address', () => {
    expect(
      hasValidRequestOrigin(
        new Request('http://0.0.0.0:3012/api/scans', {
          headers: { Host: 'localhost:3012', Origin: 'http://localhost:3012' },
        }),
      ),
    ).toBe(true);
  });
  it("supports an HTTPS reverse proxy without trusting a caller's forwarded host", () => {
    expect(
      hasValidRequestOrigin(
        new Request('http://127.0.0.1/api/scans', {
          headers: {
            Host: 'resourcedex.example',
            Origin: 'https://resourcedex.example',
          },
        }),
      ),
    ).toBe(true);
    expect(
      hasValidRequestOrigin(
        new Request('https://resourcedex.example/api/scans', {
          headers: {
            Host: 'resourcedex.example',
            Origin: 'https://attacker.example',
            'X-Forwarded-Host': 'attacker.example',
          },
        }),
      ),
    ).toBe(false);
  });
  it.each([
    'null',
    'not a URL',
    'https://attacker.example',
    'https://resourcedex.example.attacker.example',
    'file://resourcedex.example',
  ])('rejects untrusted origin "%s"', (origin) => {
    expect(
      hasValidRequestOrigin(
        new Request('https://resourcedex.example/api/scans', {
          headers: { Host: 'resourcedex.example', Origin: origin },
        }),
      ),
    ).toBe(false);
  });
});
