import { Suspense } from 'react';
import { ShareView } from '@/components/share-view';
import { Loading } from '@/components/ui';
export default function SharePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShareView />
    </Suspense>
  );
}
