import { ResourceDetail } from '@/components/resource-detail';
export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResourceDetail id={id} />;
}
