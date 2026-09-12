import type { Resource } from './types';

/** Apply the first item's area only to untouched private items from the same photo. */
export function pickupAreaRecipients(items: Resource[], first: Resource): Resource[] {
  if (!first.area_id || !first.scan_id || first.status !== 'draft') return [];
  return items.filter(
    (item) =>
      item.id !== first.id &&
      item.owner_id === first.owner_id &&
      item.scan_id === first.scan_id &&
      item.status === 'draft' &&
      !item.area_id,
  );
}
