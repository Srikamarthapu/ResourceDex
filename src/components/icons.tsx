import {
  Layers3,
  PanelsTopLeft,
  Wrench,
  Container,
  Scissors,
  CircleEllipsis,
  Nut,
  Boxes,
} from 'lucide-react';
import type { Category } from '@/lib/types';

export const categoryIcons = {
  wood: Layers3,
  metal: PanelsTopLeft,
  hardware: Nut,
  tools: Wrench,
  containers: Container,
  craft: Scissors,
  other: CircleEllipsis,
} satisfies Record<Category, typeof Boxes>;
