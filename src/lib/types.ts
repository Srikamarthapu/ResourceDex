export const categories = [
  'wood',
  'metal',
  'hardware',
  'tools',
  'containers',
  'craft',
  'other',
] as const;
export type Category = (typeof categories)[number];
export type ResourceStatus = 'draft' | 'available' | 'reserved' | 'completed' | 'withdrawn';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'fulfilled';

export interface Area {
  id: string;
  label: string;
  region_label: string;
  active?: boolean;
}
export interface Profile {
  id: string;
  display_name: string;
}
export interface Resource {
  id: string;
  owner_id: string;
  title: string;
  category: Category;
  description: string;
  quantity: number | null;
  unit: string;
  lot_label: string | null;
  condition: 'new' | 'used' | 'damaged' | 'unknown';
  working_status: 'working' | 'not_working' | 'not_tested' | 'not_applicable';
  material: string;
  dimensions: string;
  area_id: string;
  image_path: string | null;
  image_alt: string;
  status: ResourceStatus;
  revision: number;
  owner_confirmed_at: string | null;
  published_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  is_sample: boolean;
  scan_id?: string | null;
  candidate_id?: string | null;
}
export interface ResourceRequest {
  id: string;
  resource_id: string;
  requester_id: string;
  resource_revision: number;
  note: string;
  proposed_window: string;
  status: RequestStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
}
export interface PickupArrangement {
  request_id: string;
  meeting_place: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  instructions: string;
  revision: number;
  agreement_status: 'proposed' | 'agreed' | 'change_requested';
  change_note: string | null;
}
export const categoryLabels: Record<Category, string> = {
  wood: 'Wood',
  metal: 'Metal',
  hardware: 'Hardware',
  tools: 'Tools',
  containers: 'Containers',
  craft: 'Craft supplies',
  other: 'Other materials',
};
export const conditionLabels: Record<Resource['condition'], string> = {
  new: 'New / unused',
  used: 'Used',
  damaged: 'Visibly damaged',
  unknown: 'Condition unknown',
};
