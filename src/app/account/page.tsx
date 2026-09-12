import { Suspense } from 'react';
import { AccountView } from '@/components/account-view';
import { Loading } from '@/components/ui';
export default function AccountPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccountView />
    </Suspense>
  );
}
