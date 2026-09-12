import { EmptyState } from '@/components/ui';
export default function NotFound() {
  return (
    <div className="page-container">
      <EmptyState title="This resource is unavailable" href="/" action="Explore resources">
        It may have been withdrawn, collected, or removed.
      </EmptyState>
    </div>
  );
}
