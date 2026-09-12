import type { ResourceSaveInput } from './data/resources';

export function validatePublication(value: ResourceSaveInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (value.title.trim().length < 3 || value.title.trim().length > 80)
    errors.title = 'Use a title of 3–80 characters.';
  if (value.description.trim().length < 10 || value.description.length > 1000)
    errors.description = 'Describe what is included in 10–1,000 characters.';
  if (
    !value.lot_label?.trim() &&
    (!value.quantity || !Number.isInteger(value.quantity) || value.quantity <= 0)
  )
    errors.quantity = 'Enter a positive whole number or describe one lot.';
  if (value.lot_label && value.lot_label.length > 80)
    errors.quantity = 'Keep the lot description within 80 characters.';
  if (!value.unit.trim() || value.unit.length > 40)
    errors.quantity = 'Use a unit of 1–40 characters.';
  if (value.dimensions.length > 120) errors.dimensions = 'Keep measurements within 120 characters.';
  if (!value.area_id) errors.area_id = 'Choose a coarse pickup area.';
  if (!value.image_path) errors.image_path = 'Add an actual photo before publishing.';
  if (value.image_alt.trim().length < 3 || value.image_alt.length > 300)
    errors.image_alt = 'Describe the photo for people using a screen reader.';
  if (value.category === 'tools' && value.working_status === 'not_applicable')
    errors.working_status = 'Select a working status, including Not tested if unknown.';
  return errors;
}
