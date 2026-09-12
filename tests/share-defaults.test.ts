import { describe, expect, it } from 'vitest';
import { pickupAreaRecipients } from '../src/lib/share-defaults';
import type { Resource } from '../src/lib/types';

const item = (id: string, patch: Partial<Resource> = {}) =>
  ({
    id,
    owner_id: 'owner',
    scan_id: 'photo',
    status: 'draft',
    area_id: '',
    ...patch,
  }) as Resource;

describe('pickup defaults for a photo', () => {
  it('fills empty siblings without changing explicit choices or unrelated records', () => {
    const first = item('first', { area_id: 'campus' });
    const untouched = item('untouched');
    const records = [
      first,
      untouched,
      item('chosen', { area_id: 'workshop' }),
      item('other-photo', { scan_id: 'another' }),
      item('another-owner', { owner_id: 'another' }),
      item('published', { status: 'available' }),
    ];
    expect(pickupAreaRecipients(records, first)).toEqual([untouched]);
    expect(untouched.area_id).toBe('');
  });

  it('preserves saved defaults and overrides after a reload or a change to the first area', () => {
    const first = item('first', { area_id: 'new-area' });
    const restored = JSON.parse(
      JSON.stringify([
        first,
        item('inherited', { area_id: 'old-area' }),
        item('override', { area_id: 'own-area' }),
      ]),
    ) as Resource[];
    expect(pickupAreaRecipients(restored, first)).toEqual([]);
  });

  it('lets a retry target only items whose default has not already been saved', () => {
    const first = item('first', { area_id: 'campus' });
    const remaining = item('interrupted');
    expect(
      pickupAreaRecipients([first, item('saved', { area_id: 'campus' }), remaining], first),
    ).toEqual([remaining]);
  });

  it.each([{ area_id: '' }, { scan_id: null }, { status: 'available' as const }])(
    'does not infer defaults from %j',
    (patch) => {
      expect(
        pickupAreaRecipients([item('second')], item('first', { area_id: 'campus', ...patch })),
      ).toEqual([]);
    },
  );
});
