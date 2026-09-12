'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from './app-provider';
import { ResourceCard } from './resource-card';
import { EmptyState, Loading, Notice, PageHeading } from './ui';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import {
  getResourceImageUrl,
  listAreas,
  listMyResources,
  withdrawResource,
} from '@/lib/data/resources';
import { useLiveQuery } from '@/lib/use-live-query';
import { errorMessage } from '@/lib/format';
import { deleteResourceDrafts } from '@/lib/data/drafts';

export function MyResources() {
  const { user, authLoading } = useApp();
  const [tab, setTab] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const client = createBrowserSupabaseClient();
    const [resources, areas] = await Promise.all([listMyResources(client), listAreas(client)]);
    const images = Object.fromEntries(
      await Promise.all(
        resources.map(async (resource) => [
          resource.id,
          await getResourceImageUrl(client, resource),
        ]),
      ),
    );
    return { resources, areas, images };
  }, []);
  const { data, loading, error: queryError, refresh } = useLiveQuery(load, Boolean(user));
  const drafts = data?.resources.filter((resource) => resource.status === 'draft') ?? [];
  async function deleteDrafts(ids: string[]) {
    if (busy || !ids.length) return;
    const selection = ids.length === 1 ? 'this saved draft' : `these ${ids.length} saved drafts`;
    if (
      !window.confirm(
        `Delete ${selection}? Their listing details will be permanently removed. Other resources will stay as they are.`,
      )
    )
      return;
    setBusy(ids.length === 1 ? ids[0] : 'all-drafts');
    setError('');
    setMessage('');
    try {
      await deleteResourceDrafts(createBrowserSupabaseClient(), ids);
      setMessage(
        ids.length === 1
          ? 'Draft deleted. You can start again with a new photo.'
          : 'Drafts deleted. You can start again with a new photo.',
      );
      refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }
  async function withdraw(id: string) {
    if (
      !window.confirm(
        'Withdraw this resource? Any active requests will be canceled and private pickup access will close.',
      )
    )
      return;
    setBusy(id);
    setError('');
    setMessage('');
    try {
      await withdrawResource(createBrowserSupabaseClient(), id);
      refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }
  if (authLoading) return <Loading />;
  return (
    <div className="page-container">
      <PageHeading
        eyebrow="Your corner of the community"
        title="My resources"
        action={
          user ? (
            <Link href="/share" className="button primary">
              <Plus size={16} />
              Share a resource
            </Link>
          ) : undefined
        }
      >
        A place for your spare materials, saved drafts, and second beginnings.
      </PageHeading>
      {!user ? (
        <EmptyState
          title="Make room for something new"
          href="/account?next=/my-resources"
          action="Sign in"
        >
          Sign in to share resources, pick up where you left off, and keep track of your handoffs.
        </EmptyState>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Resource status">
            {[
              ['all', 'All resources'],
              ['draft', 'Drafts'],
              ['available', 'Available'],
              ['reserved', 'Reserved'],
              ['completed', 'Collected'],
              ['withdrawn', 'Withdrawn'],
            ].map(([value, label]) => (
              <button
                className={`tab ${tab === value ? 'active' : ''}`}
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
              >
                {label}{' '}
                {data && (
                  <span>
                    (
                    {
                      data.resources.filter((item) => value === 'all' || item.status === value)
                        .length
                    }
                    )
                  </span>
                )}
              </button>
            ))}
          </div>
          {(error || queryError) && <Notice error>{error || queryError}</Notice>}
          {message && <Notice>{message}</Notice>}
          {!loading && drafts.length > 1 && ['all', 'draft'].includes(tab) && (
            <div className="draft-manage-bar">
              <p>Remove unfinished drafts when you want to start fresh.</p>
              <button
                className="button small danger"
                disabled={Boolean(busy)}
                onClick={() => deleteDrafts(drafts.map((draft) => draft.id))}
              >
                <Trash2 size={15} />
                {busy === 'all-drafts' ? 'Deleting drafts…' : 'Delete all drafts'}
              </button>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : !data?.resources.some((item) => tab === 'all' || item.status === tab) ? (
            <EmptyState
              title={tab === 'draft' ? 'No unfinished ideas' : 'Your next share starts here'}
              href="/share"
              action="Share a resource"
            >
              Add something you no longer need. A photo and a few details are all it takes.
            </EmptyState>
          ) : (
            <div className="my-resource-grid">
              {data.resources
                .filter((item) => tab === 'all' || item.status === tab)
                .map((resource) => (
                  <div key={resource.id}>
                    <ResourceCard
                      resource={resource}
                      imageUrl={data.images[resource.id]}
                      area={
                        data.areas.find((area) => area.id === resource.area_id)?.label ||
                        'Area not selected'
                      }
                      href={
                        ['draft', 'withdrawn'].includes(resource.status)
                          ? `/share?draft=${resource.id}`
                          : `/resources/${resource.id}`
                      }
                    />
                    <div className="resource-manage-actions">
                      {resource.status === 'reserved' ? (
                        <Link className="button small" href="/requests">
                          Arrange pickup
                        </Link>
                      ) : ['draft', 'available', 'withdrawn'].includes(resource.status) ? (
                        <Link className="button small" href={`/share?draft=${resource.id}`}>
                          {resource.status === 'draft'
                            ? 'Resume draft'
                            : resource.status === 'withdrawn'
                              ? 'Review & republish'
                              : 'Edit resource'}
                        </Link>
                      ) : (
                        <Link className="button small" href={`/resources/${resource.id}`}>
                          View history
                        </Link>
                      )}
                      {['available', 'reserved'].includes(resource.status) && (
                        <button
                          className="button small"
                          disabled={Boolean(busy)}
                          onClick={() => withdraw(resource.id)}
                        >
                          Withdraw
                        </button>
                      )}
                      {resource.status === 'draft' && (
                        <button
                          className="button small danger"
                          aria-label={`Delete draft: ${resource.title || 'Untitled resource'}`}
                          disabled={Boolean(busy)}
                          onClick={() => deleteDrafts([resource.id])}
                        >
                          <Trash2 size={15} />
                          {busy === resource.id ? 'Deleting…' : 'Delete draft'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
