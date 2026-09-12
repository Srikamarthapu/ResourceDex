import type { Metadata } from 'next';
import { RequestsView } from '@/components/requests-view';

export const metadata: Metadata = { title: 'Requests · ResourceDex' };

export default function RequestsPage() {
  return <RequestsView />;
}
