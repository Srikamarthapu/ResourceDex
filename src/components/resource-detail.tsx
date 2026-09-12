'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flag,
  Info,
  LockKeyhole,
  MapPin,
  Package,
  Share2,
  X,
} from 'lucide-react';
import { useApp } from './app-provider';
import { EmptyState, Loading, Notice } from './ui';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getProfiles, getResource, getResourceImageUrl, listAreas } from '@/lib/data/resources';
import { createRequest, listRequests, reportResource } from '@/lib/data/requests';
import { useLiveQuery } from '@/lib/use-live-query';
import { categoryLabels, conditionLabels, type ResourceRequest } from '@/lib/types';
import { sampleAreas, sampleResources } from '@/lib/sample-resources';
import { errorMessage, quantityLabel } from '@/lib/format';
import { createClientId } from '@/lib/client-id';

export function ResourceDetail({ id }: { id: string }) {
  const { user, configured } = useApp();
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestKey = useRef<string | null>(null);
  const reportDialog = useRef<HTMLDialogElement>(null);
  const isExample = id.startsWith('sample-');
  const load = useCallback(async () => {
    if (isExample)
      return {
        resource: sampleResources.find((item) => item.id === id) || null,
        area:
          sampleAreas.find(
            (item) => item.id === sampleResources.find((resource) => resource.id === id)?.area_id,
          )?.label || '',
        imageUrl: sampleResources.find((item) => item.id === id)?.image_path || null,
        owner: 'Sample community member',
        request: null as ResourceRequest | null,
      };
    if (!configured) return null;
    const client = createBrowserSupabaseClient();
    const resource = await getResource(client, id);
    if (!resource) return null;
    const [areas, profiles, imageUrl, requests] = await Promise.all([
      listAreas(client),
      getProfiles(client, [resource.owner_id]),
      getResourceImageUrl(client, resource),
      user ? listRequests(client) : Promise.resolve([]),
    ]);
    return {
      resource,
      area: areas.find((item) => item.id === resource.area_id)?.label || 'Pickup area',
      imageUrl,
      owner: profiles[0]?.display_name || 'Community member',
      request:
        requests.find(
          (item) =>
            item.resource_id === id &&
            item.requester_id === user?.id &&
            ['pending', 'accepted'].includes(item.status),
        ) || null,
    };
  }, [id, isExample, configured, user]);
  const { data, loading, error: loadError, refresh } = useLiveQuery(load);
  if (loading) return <Loading />;
  if (loadError)
    return (
      <div className="page-container">
        <Notice error>
          {loadError}
          <button className="button small" onClick={refresh}>
            Try again
          </button>
        </Notice>
      </div>
    );
  if (!data?.resource)
    return (
      <div className="page-container">
        <EmptyState title="This resource is unavailable" href="/" action="Explore resources">
          It may have been withdrawn, collected, or removed.
        </EmptyState>
      </div>
    );
  const { resource, imageUrl, area, owner, request } = data;
  const own = user?.id === resource.owner_id;
  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      requestKey.current ||= createClientId();
      await createRequest(
        createBrowserSupabaseClient(),
        id,
        String(form.get('note') || ''),
        String(form.get('window') || ''),
        requestKey.current,
      );
      requestKey.current = null;
      setRequestOpen(false);
      setMessage('Request sent. It’s pending until the owner accepts.');
      refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await reportResource(
        createBrowserSupabaseClient(),
        id,
        String(form.get('reason')) as 'unsafe' | 'prohibited' | 'misleading' | 'other',
        String(form.get('note') || ''),
      );
      reportDialog.current?.close();
      setMessage('Report submitted privately for operator review.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-container">
      <div className="breadcrumb">
        <Link href={isExample ? '/?samples=1' : '/'}>
          <ArrowLeft size={13} /> Explore resources
        </Link>
        <span>/</span>
        <span>{categoryLabels[resource.category]}</span>
      </div>
      {resource.is_sample && (
        <div className="notice-stack">
          <Notice>
            <Info size={16} />
            Sample listing · This demonstrates the sharing flow. No real item is offered for
            collection.
          </Notice>
        </div>
      )}
      <div className="detail-layout">
        <div>
          <div className="detail-photo">
            {imageUrl ? (
              <img src={imageUrl} alt={resource.image_alt} width={800} height={800} />
            ) : (
              <Package size={65} strokeWidth={1} />
            )}
          </div>
          <p className="photo-caption">
            <Info size={12} />
            {resource.is_sample
              ? 'Illustrative sample photograph. Material and condition are unverified.'
              : 'Owner-approved photo. Check the details with the owner before pickup.'}
          </p>
        </div>
        <section className="detail-content">
          <div className="detail-topline">
            <p className="eyebrow">{categoryLabels[resource.category]}</p>
            <span className={`status pill ${resource.status}`}>
              {resource.status[0].toUpperCase() + resource.status.slice(1)}
            </span>
          </div>
          <h1>{resource.title}</h1>
          <p className="detail-summary">{resource.description}</p>
          <div className="detail-price">
            Free<span>Whole listing · {quantityLabel(resource)}</span>
          </div>
          <section className="detail-section">
            <h2>About this resource</h2>
            <dl className="facts-grid">
              <div>
                <dt>Condition</dt>
                <dd>{conditionLabels[resource.condition]}</dd>
              </div>
              <div>
                <dt>Material</dt>
                <dd>{resource.material || 'Material unknown'}</dd>
              </div>
              <div>
                <dt>Dimensions</dt>
                <dd>{resource.dimensions || 'Dimensions not provided'}</dd>
              </div>
              <div>
                <dt>{resource.category === 'tools' ? 'Working status' : 'Shared by'}</dt>
                <dd>
                  {resource.category === 'tools'
                    ? {
                        working: 'Working, per owner',
                        not_working: 'Not working, per owner',
                        not_tested: 'Not tested',
                        not_applicable: 'Not tested',
                      }[resource.working_status]
                    : owner}
                </dd>
              </div>
            </dl>
            <p className="fact-note">
              <Check size={12} />
              Details are owner statements, not an independent inspection.
            </p>
          </section>
          <section className="detail-section">
            <h2>Possible uses</h2>
            <p style={{ fontSize: 12 }}>
              Reference suggestions aren’t available yet. Ask the owner about material,
              measurements, and condition before planning your project.
            </p>
          </section>
          <section className="detail-section">
            <h2>Pickup</h2>
            <div className="pickup-summary">
              <MapPin size={18} />
              <p>
                <strong>{area}</strong>Local pickup only. The owner shares a meeting place privately
                after accepting a request.
              </p>
            </div>
          </section>
          <div className="detail-actions">
            {error && <Notice error>{error}</Notice>}
            {message && <Notice>{message}</Notice>}
            {isExample ? (
              <>
                <p>This example is here to help you explore the app.</p>
                <Link href="/share" className="button primary">
                  Share something of your own <ArrowRight size={15} />
                </Link>
              </>
            ) : own ? (
              <>
                <p>You shared this resource. Manage incoming requests to arrange its next home.</p>
                <Link href="/requests" className="button primary">
                  Manage requests <ArrowRight size={15} />
                </Link>
                {['available', 'draft', 'withdrawn'].includes(resource.status) && (
                  <Link href={`/share?draft=${id}`} className="button">
                    Edit resource
                  </Link>
                )}
              </>
            ) : request ? (
              <>
                <p>
                  <strong>
                    {request.status === 'accepted'
                      ? 'Your request was accepted.'
                      : 'Your request is waiting for the owner.'}
                  </strong>
                </p>
                <Link href="/requests" className="button primary">
                  View your request <ArrowRight size={15} />
                </Link>
              </>
            ) : resource.status !== 'available' ? (
              <p>
                This resource is {resource.status}. Explore other available materials while the
                owner arranges pickup.
              </p>
            ) : !user ? (
              <>
                <Link href={`/account?next=/resources/${id}`} className="button primary">
                  Sign in to request pickup <ArrowRight size={15} />
                </Link>
                <p>No payments. No shipping. Just a useful local exchange.</p>
              </>
            ) : requestOpen ? (
              <form onSubmit={sendRequest} className="inline-form">
                <div className="form-field">
                  <label htmlFor="request-note">
                    A note for the owner <span>(optional)</span>
                  </label>
                  <textarea
                    id="request-note"
                    name="note"
                    maxLength={500}
                    placeholder="Let them know what you have in mind."
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="request-window">When could you pick it up?</label>
                  <input
                    id="request-window"
                    name="window"
                    required
                    maxLength={200}
                    placeholder="For example, Saturday afternoon"
                  />
                </div>
                <p className="field-hint">
                  You’re requesting the entire listing. It’s pending until the owner accepts.
                </p>
                <button className="button primary" disabled={busy}>
                  {busy ? 'Sending request…' : 'Send pickup request'}
                  <ArrowRight size={15} />
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => setRequestOpen(false)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button className="button primary full" onClick={() => setRequestOpen(true)}>
                  Request pickup <ArrowRight size={16} />
                </button>
                <p>
                  <LockKeyhole size={11} style={{ display: 'inline', marginRight: 4 }} />
                  Your request and pickup details stay private.
                </p>
              </>
            )}
          </div>
          <div className="detail-footer-actions">
            <button
              className="text-link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(location.href);
                  setMessage('Resource link copied.');
                } catch {
                  setMessage('Copy the address from your browser to share this resource.');
                }
              }}
            >
              <Share2 size={13} />
              Copy link
            </button>
            {user && !own && !isExample && (
              <button className="text-link" onClick={() => reportDialog.current?.showModal()}>
                <Flag size={12} />
                Report resource
              </button>
            )}
          </div>
        </section>
      </div>
      <dialog ref={reportDialog} className="dialog">
        <div className="dialog-header">
          <h2>Report resource</h2>
          <button
            className="icon-button"
            aria-label="Close report"
            onClick={() => reportDialog.current?.close()}
          >
            <X size={19} />
          </button>
        </div>
        {error && <Notice error>{error}</Notice>}
        <form onSubmit={report} className="inline-form">
          <div className="form-field">
            <label htmlFor="report-reason">Reason</label>
            <select name="reason" id="report-reason">
              <option value="misleading">Inaccurate or unavailable</option>
              <option value="unsafe">Unsafe material</option>
              <option value="prohibited">Out of scope</option>
              <option value="other">Something else</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="report-note">
              More detail <span>(optional)</span>
            </label>
            <textarea id="report-note" name="note" maxLength={1000} />
          </div>
          <p className="field-hint">Reports go privately to the pilot operator.</p>
          <button className="button primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit report'}
          </button>
        </form>
      </dialog>
    </div>
  );
}
