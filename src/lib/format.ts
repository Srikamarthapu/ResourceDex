import type { Resource } from './types';

export function quantityLabel(resource: Pick<Resource, 'quantity' | 'unit' | 'lot_label'>) {
  return (
    resource.lot_label ||
    (resource.quantity
      ? `${resource.quantity} ${resource.unit || 'pieces'}`
      : 'One lot · count unknown')
  );
}
export function dateLabel(date: string | null) {
  if (!date) return 'Recently shared';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
