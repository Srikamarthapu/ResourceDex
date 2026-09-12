'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Check, LockKeyhole, MapPin, Package, RefreshCw } from 'lucide-react';
import { useApp } from './app-provider';
import { EmptyState, Loading, Notice, PageHeading } from './ui';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getProfiles, getResource, getResourceImageUrl, listAreas } from '@/lib/data/resources';
import {
  getPickupArrangement,
  listRequests,
  respondToPickup,
  savePickupArrangement,
  transitionRequest,
  type PickupInput,
} from '@/lib/data/requests';
import type { PickupArrangement, RequestStatus, Resource, ResourceRequest } from '@/lib/types';
import { dateLabel, errorMessage, quantityLabel } from '@/lib/format';
import { useLiveQuery } from '@/lib/use-live-query';

type Direction = 'incoming' | 'outgoing';
type StatusFilter = 'all' | 'pending' | 'accepted' | 'history';
type RequestEntry = {
  request: ResourceRequest;
  resource: Resource | null;
  counterpart: string;
  area: string;
  image: string | null;
  pickup: PickupArrangement | null;
  pickupError: string;
};
type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;

const statusLabels: Record<RequestStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  canceled: 'Canceled',
  fulfilled: 'Collected',
};

/** Account changes remount the private query and all open pickup forms. */
export function RequestsView() {
  const { user, configured, authLoading } = useApp();
  return (
    <div className="page-container" style={{ maxWidth: 980 }}>
      <PageHeading eyebrow="Make the handoff happen" title="Requests">
        Keep track of what you&apos;re sharing, what you&apos;ve requested, and the next pickup.
      </PageHeading>
      {authLoading ? (
        <Loading label="Checking your account" />
      ) : !configured || !user ? (
        <EmptyState
          title="Your next handoff starts here"
          href="/account?next=/requests"
          action="Sign in to see requests"
        >
          Sign in to review incoming requests and arrange pickups for resources you&apos;ve found.
        </EmptyState>
      ) : !user.email_confirmed_at ? (
        <EmptyState
          title="Verify your email to continue"
          href="/account?next=/requests"
          action="Open your account"
        >
          Confirm your email address before requesting resources or arranging a pickup.
        </EmptyState>
      ) : (
        <AccountRequests key={user.id} userId={user.id} />
      )}
    </div>
  );
}

function AccountRequests({ userId }: { userId: string }) {
  const [direction, setDirection] = useState<Direction>('incoming');
  const [status, setStatus] = useState<StatusFilter>('all');
  const load = useCallback(async () => {
    const client = createBrowserSupabaseClient();
    const [requests, areas] = await Promise.all([listRequests(client), listAreas(client)]);
    const ids = [...new Set(requests.map((request) => request.resource_id))];
    const resources = await Promise.all(ids.map((id) => getResource(client, id)));
    const resourceById = new Map(
      resources.filter((item): item is Resource => item !== null).map((item) => [item.id, item]),
    );
    const profiles = await getProfiles(client, [
      ...requests.map((request) => request.requester_id),
      ...resources.flatMap((item) => (item ? [item.owner_id] : [])),
    ]);
    const images = new Map(
      await Promise.all(
        [...resourceById.values()].map(
          async (item) => [item.id, await getResourceImageUrl(client, item)] as const,
        ),
      ),
    );

    return Promise.all(
      requests.map(async (request) => {
        const resource = resourceById.get(request.resource_id) ?? null;
        const counterpartId =
          request.requester_id === userId ? resource?.owner_id : request.requester_id;
        let pickup: PickupArrangement | null = null;
        let pickupError = '';
        // A canceled request never issues another pickup read from this screen.
        if (request.status === 'accepted' || request.status === 'fulfilled') {
          try {
            pickup = await getPickupArrangement(client, request.id);
          } catch (failure) {
            pickupError = errorMessage(failure);
          }
        }
        return {
          request,
          resource,
          pickup,
          pickupError,
          counterpart:
            profiles.find((profile) => profile.id === counterpartId)?.display_name ||
            'Community member',
          area:
            areas.find((area) => area.id === resource?.area_id)?.label ||
            'Pickup area not available',
          image: images.get(request.resource_id) ?? null,
        } satisfies RequestEntry;
      }),
    );
  }, [userId]);
  const { data, loading, error, refresh } = useLiveQuery(load);
  const entries = data ?? [];
  const belongsToDirection = (entry: RequestEntry, value: Direction) =>
    (entry.request.requester_id === userId) === (value === 'outgoing');
  const visible = entries.filter(
    (entry) =>
      belongsToDirection(entry, direction) &&
      (status === 'all' ||
        (status === 'history'
          ? !['pending', 'accepted'].includes(entry.request.status)
          : entry.request.status === status)),
  );

  return (
    <>
      <div className="tabs" role="group" aria-label="Request direction">
        {(['incoming', 'outgoing'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={`tab ${direction === value ? 'active' : ''}`}
            aria-pressed={direction === value}
            onClick={() => setDirection(value)}
          >
            {value === 'incoming' ? 'Incoming' : 'Outgoing'}{' '}
            <span className="result-count">
              {entries.filter((entry) => belongsToDirection(entry, value)).length}
            </span>
          </button>
        ))}
      </div>
      <div className="results-heading">
        <div className="form-field">
          <label htmlFor="request-status">Show requests</label>
          <select
            id="request-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="all">All requests</option>
            <option value="pending">Waiting for owner</option>
            <option value="accepted">Arranging pickup</option>
            <option value="history">Past requests</option>
          </select>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={refresh}
          style={{ marginLeft: 'auto' }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {error && (
        <Notice error>
          {error}{' '}
          {data
            ? 'The last loaded requests are shown. Refresh before making changes.'
            : 'Refresh to try again.'}
        </Notice>
      )}
      {loading ? (
        <Loading label="Loading your requests" />
      ) : visible.length ? (
        <div className="request-list" style={{ marginTop: error ? 18 : 0 }}>
          {visible.map((entry) => (
            <RequestCard
              key={entry.request.id}
              entry={entry}
              isOwner={entry.request.requester_id !== userId}
              onChange={refresh}
              readError={Boolean(error)}
            />
          ))}
        </div>
      ) : (
        !error && (
          <EmptyState
            title={
              status !== 'all'
                ? 'No requests in this view'
                : direction === 'incoming'
                  ? 'A little space for what comes next'
                  : 'Find something for your next project'
            }
            href={direction === 'incoming' ? '/my-resources' : '/'}
            action={direction === 'incoming' ? 'See your resources' : 'Explore materials'}
          >
            {status !== 'all'
              ? 'Choose another request status to see the rest of your handoffs.'
              : direction === 'incoming'
                ? 'When someone requests one of your resources, you can review it here and choose a pickup together.'
                : 'Request a whole resource from Explore. You can follow the owner’s response and arrange pickup here.'}
          </EmptyState>
        )
      )}
    </>
  );
}

function RequestCard({
  entry,
  isOwner,
  onChange,
  readError,
}: {
  entry: RequestEntry;
  isOwner: boolean;
  onChange: () => void;
  readError: boolean;
}) {
  const { request, resource, counterpart } = entry;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const actionInFlight = useRef(false);
  const run: RunAction = async (label, action) => {
    if (actionInFlight.current || readError) return false;
    actionInFlight.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(label);
      onChange();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      onChange();
      return false;
    } finally {
      setBusy('');
      actionInFlight.current = false;
    }
  };
  const transition = (action: 'accept' | 'decline' | 'cancel' | 'complete', label: string) => {
    if (
      action === 'cancel' &&
      !window.confirm(
        request.status === 'accepted'
          ? 'Cancel this reservation? The resource will become available again, and pickup details will no longer be available to the requester.'
          : 'Cancel your pending request?',
      )
    )
      return;
    if (
      action === 'complete' &&
      !window.confirm(
        resource?.is_sample
          ? 'Record a simulated collection for this sample resource? No physical handoff is taking place.'
          : 'Have you handed this resource to the requester? This records it as collected and closes the reservation.',
      )
    )
      return;
    void run(label, () => transitionRequest(createBrowserSupabaseClient(), request.id, action));
  };
  const disabled = Boolean(busy) || readError;
  const pending = request.status === 'pending';
  const accepted = request.status === 'accepted';

  return (
    <article
      className="request-card"
      aria-labelledby={`request-${request.id}`}
      aria-busy={Boolean(busy)}
    >
      <div className="request-overview">
        {entry.image && resource ? (
          // Signed image URLs are issued only after Storage checks current access.
          <img className="request-thumbnail" src={entry.image} alt={resource.image_alt} />
        ) : (
          <div
            className="request-thumbnail"
            aria-hidden="true"
            style={{ display: 'grid', placeItems: 'center' }}
          >
            <Package size={24} />
          </div>
        )}
        <div className="request-content" style={{ overflowWrap: 'anywhere' }}>
          <div className="request-title-row">
            <h2 id={`request-${request.id}`}>
              {resource ? (
                <Link href={`/resources/${resource.id}`}>{resource.title}</Link>
              ) : (
                'This resource is unavailable'
              )}
            </h2>
            <span className={`request-state ${request.status}`}>
              {statusLabels[request.status]}
            </span>
          </div>
          <p>
            {isOwner ? 'Requested by' : 'Shared by'} <strong>{counterpart}</strong> ·{' '}
            <time dateTime={request.created_at}>{dateLabel(request.created_at)}</time>
          </p>
          {resource && (
            <p>
              {quantityLabel(resource)} · Free · {entry.area}
            </p>
          )}
          {resource?.is_sample && (
            <p className="field-hint">
              Sample resource · Test pickup only; no real inventory is offered.
            </p>
          )}
          {request.status === 'fulfilled' && (
            <p>
              <Check size={12} aria-hidden="true" /> Collection recorded by the owner.
            </p>
          )}
        </div>
      </div>
      {request.note && (
        <p className="request-note" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <strong>Request note</strong>
          <br />
          {request.note}
        </p>
      )}
      {request.proposed_window && (
        <p className="field-hint" style={{ marginTop: 12, overflowWrap: 'anywhere' }}>
          <strong>Suggested pickup:</strong> {request.proposed_window}
        </p>
      )}
      {request.reason && (
        <p className="field-hint" style={{ marginTop: 12, overflowWrap: 'anywhere' }}>
          {request.reason}
        </p>
      )}
      {pending && (
        <p className="field-hint" style={{ marginTop: 12 }}>
          {isOwner
            ? 'Accepting reserves the whole resource for this person and declines the other pending requests.'
            : 'Your request is pending until the owner accepts.'}
        </p>
      )}
      {(pending || accepted) && (
        <div className="request-actions">
          {pending && isOwner && (
            <>
              <button
                className="button primary small"
                type="button"
                disabled={disabled}
                onClick={() => transition('accept', 'Request accepted. The resource is reserved.')}
              >
                <Check size={14} />
                Accept request
              </button>
              <button
                className="button secondary small"
                type="button"
                disabled={disabled}
                onClick={() => transition('decline', 'Request declined.')}
              >
                Decline
              </button>
            </>
          )}
          {accepted && isOwner && (
            <button
              className="button primary small"
              type="button"
              disabled={disabled}
              onClick={() =>
                transition('complete', 'Collection recorded. The resource is now completed.')
              }
            >
              Mark as collected
            </button>
          )}
          {(accepted || (pending && !isOwner)) && (
            <button
              className="button secondary small"
              type="button"
              disabled={disabled}
              onClick={() => transition('cancel', 'Request canceled.')}
            >
              {accepted ? 'Cancel reservation' : 'Cancel request'}
            </button>
          )}
        </div>
      )}
      {(accepted || request.status === 'fulfilled') && (
        <PickupPanel
          request={request}
          pickup={entry.pickup}
          pickupError={entry.pickupError}
          isOwner={isOwner}
          busy={disabled}
          run={run}
          onRefresh={onChange}
        />
      )}
      {busy && (
        <p role="status" className="field-hint" style={{ marginTop: 14 }}>
          Saving your change…
        </p>
      )}
      {error && (
        <div style={{ marginTop: 14 }}>
          <Notice error>{error}</Notice>
        </div>
      )}
      {message && (
        <p className="field-hint" role="status" style={{ marginTop: 14 }}>
          {message}
        </p>
      )}
    </article>
  );
}

function PickupPanel({
  request,
  pickup,
  pickupError,
  isOwner,
  busy,
  run,
  onRefresh,
}: {
  request: ResourceRequest;
  pickup: PickupArrangement | null;
  pickupError: string;
  isOwner: boolean;
  busy: boolean;
  run: RunAction;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [changeForm, setChangeForm] = useState<{ revision: number; note: string } | null>(null);
  const active = request.status === 'accepted';
  const changeIsStale = changeForm !== null && pickup?.revision !== changeForm.revision;
  async function respond(event: FormEvent) {
    event.preventDefault();
    if (!changeForm || changeIsStale) return;
    if (
      await run('Pickup change requested.', () =>
        respondToPickup(
          createBrowserSupabaseClient(),
          request.id,
          changeForm.revision,
          'request_change',
          changeForm.note.trim(),
        ),
      )
    )
      setChangeForm(null);
  }

  return (
    <section className="pickup-card" aria-label="Private pickup arrangement">
      <h3>
        <LockKeyhole size={16} aria-hidden="true" />
        Private pickup
      </h3>
      {pickupError ? (
        <>
          <Notice error>{pickupError}</Notice>
          <button
            className="button secondary small"
            type="button"
            onClick={onRefresh}
            style={{ marginTop: 12 }}
          >
            Retry pickup details
          </button>
        </>
      ) : (
        <>
          <p className="field-hint" style={{ marginBottom: 16 }}>
            {active
              ? 'Shared only between the owner and the accepted requester.'
              : 'Pickup details remain available to both participants for 30 days after collection.'}
          </p>
          {active && isOwner && (!pickup || editing) ? (
            <PickupForm
              requestId={request.id}
              initial={pickup}
              busy={busy}
              run={run}
              onClose={() => setEditing(false)}
            />
          ) : pickup ? (
            <>
              <div className="pickup-details">
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <MapPin size={13} aria-hidden="true" /> <strong>{pickup.meeting_place}</strong>
                </p>
                <p>
                  <time dateTime={pickup.starts_at}>
                    {pickupTimeLabel(pickup.starts_at, pickup.timezone)}
                  </time>{' '}
                  –{' '}
                  <time dateTime={pickup.ends_at}>
                    {pickupTimeLabel(pickup.ends_at, pickup.timezone)}
                  </time>
                </p>
                <p>{pickup.timezone}</p>
                {pickup.instructions && (
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {pickup.instructions}
                  </p>
                )}
                <p>
                  <strong>
                    {pickup.agreement_status === 'agreed'
                      ? 'Pickup agreed'
                      : pickup.agreement_status === 'change_requested'
                        ? 'A change was requested'
                        : 'Waiting for requester agreement'}
                  </strong>
                </p>
                {pickup.change_note && (
                  <p
                    className="request-note"
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {pickup.change_note}
                  </p>
                )}
              </div>
              {active && (
                <div className="request-actions">
                  {isOwner ? (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      type="button"
                      onClick={() => setEditing(true)}
                    >
                      Edit pickup details
                    </button>
                  ) : (
                    <>
                      {pickup.agreement_status !== 'agreed' && (
                        <button
                          className="button primary small"
                          disabled={busy}
                          type="button"
                          onClick={() =>
                            void run('Pickup arrangement agreed.', () =>
                              respondToPickup(
                                createBrowserSupabaseClient(),
                                request.id,
                                pickup.revision,
                                'agree',
                              ),
                            )
                          }
                        >
                          Agree to pickup
                        </button>
                      )}
                      <button
                        className="button secondary small"
                        disabled={busy}
                        type="button"
                        onClick={() => setChangeForm({ revision: pickup.revision, note: '' })}
                      >
                        Request a change
                      </button>
                    </>
                  )}
                </div>
              )}
              {active && !isOwner && changeForm && (
                <form className="pickup-form" onSubmit={respond} style={{ marginTop: 18 }}>
                  <div className="form-field">
                    <label htmlFor={`change-${request.id}`}>What needs to change?</label>
                    <textarea
                      id={`change-${request.id}`}
                      required
                      disabled={busy}
                      maxLength={500}
                      value={changeForm.note}
                      onChange={(event) =>
                        setChangeForm({ ...changeForm, note: event.target.value })
                      }
                    />
                  </div>
                  {changeIsStale && (
                    <Notice error>
                      The pickup proposal changed. Close this note and review the new details before
                      responding.
                    </Notice>
                  )}
                  <div className="request-actions">
                    <button
                      className="button primary small"
                      disabled={busy || changeIsStale || !changeForm.note.trim()}
                    >
                      Send change request
                    </button>
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={busy}
                      onClick={() => setChangeForm(null)}
                    >
                      Close
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <p className="field-hint">
              {active
                ? 'The owner will add a meeting place and pickup time here.'
                : 'Pickup details are no longer available.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PickupForm({
  requestId,
  initial,
  busy,
  run,
  onClose,
}: {
  requestId: string;
  initial: PickupArrangement | null;
  busy: boolean;
  run: RunAction;
  onClose: () => void;
}) {
  const [originalRevision] = useState(initial?.revision ?? 0);
  const [timezone, setTimezone] = useState(
    initial?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [meetingPlace, setMeetingPlace] = useState(initial?.meeting_place ?? '');
  const [start, setStart] = useState(
    initial ? wallTimeValue(initial.starts_at, initial.timezone) : '',
  );
  const [end, setEnd] = useState(initial ? wallTimeValue(initial.ends_at, initial.timezone) : '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [error, setError] = useState('');
  const stale = originalRevision !== (initial?.revision ?? 0);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (stale) return;
    try {
      if (meetingPlace.trim().length < 3)
        throw new Error('Describe the meeting place in at least three characters.');
      const input: PickupInput = {
        meeting_place: meetingPlace.trim(),
        starts_at: wallTimeToUtc(start, timezone.trim()),
        ends_at: wallTimeToUtc(end, timezone.trim()),
        timezone: timezone.trim(),
        instructions: instructions.trim(),
      };
      if (input.ends_at <= input.starts_at)
        throw new Error('Choose an end time after the start time.');
      if (
        await run('Pickup proposal saved. The requester can review it now.', () =>
          savePickupArrangement(createBrowserSupabaseClient(), requestId, input, originalRevision),
        )
      )
        onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <form className="pickup-form" onSubmit={save}>
      <div className="form-field">
        <label htmlFor={`place-${requestId}`}>Meeting place</label>
        <textarea
          id={`place-${requestId}`}
          required
          disabled={busy}
          minLength={3}
          maxLength={500}
          value={meetingPlace}
          onChange={(event) => setMeetingPlace(event.target.value)}
          placeholder="Where should the requester meet you?"
        />
      </div>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor={`start-${requestId}`}>Window starts</label>
          <input
            id={`start-${requestId}`}
            type="datetime-local"
            required
            disabled={busy}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`end-${requestId}`}>Window ends</label>
          <input
            id={`end-${requestId}`}
            type="datetime-local"
            required
            disabled={busy}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`timezone-${requestId}`}>Pickup timezone</label>
        <input
          id={`timezone-${requestId}`}
          required
          disabled={busy}
          maxLength={80}
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          aria-describedby={`timezone-hint-${requestId}`}
        />
        <p className="field-hint" id={`timezone-hint-${requestId}`}>
          Both times use this timezone, such as America/Los_Angeles or Europe/London.
        </p>
      </div>
      <div className="form-field">
        <label htmlFor={`instructions-${requestId}`}>
          Pickup instructions <span>(optional)</span>
        </label>
        <textarea
          id={`instructions-${requestId}`}
          disabled={busy}
          maxLength={1000}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>
      {initial && (
        <p className="field-hint">
          Saving a change asks the requester to agree to the updated arrangement.
        </p>
      )}
      {stale && (
        <Notice error>
          Pickup details changed in another tab. Close this form and review the latest proposal
          before editing.
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="request-actions">
        <button className="button primary small" disabled={busy || stale}>
          Save pickup proposal
        </button>
        {initial && (
          <button
            className="button secondary small"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>
    </form>
  );
}

function pickupTimeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function wallTimeValue(value: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

/** Resolve wall-clock input in its stated IANA zone, including DST gaps/repeats. */
function wallTimeToUtc(value: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Choose a valid pickup date and time.');
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal)) throw new Error('Choose a valid pickup date and time.');
  const candidates = new Set<number>();
  try {
    // Neighboring dates provide the offsets on either side of a clock change.
    for (const days of [-2, -1, 0, 1, 2]) {
      const probe = nominal + days * 86_400_000;
      const offset = Date.parse(`${wallTimeValue(probe, timezone)}:00Z`) - probe;
      const candidate = nominal - offset;
      if (wallTimeValue(candidate, timezone) === value) candidates.add(candidate);
    }
  } catch {
    throw new Error('Choose a valid timezone, such as America/Los_Angeles.');
  }
  if (!candidates.size)
    throw new Error('This time falls in a clock-change gap. Choose a different time.');
  if (candidates.size > 1)
    throw new Error(
      'This time occurs twice during a clock change. Choose a time outside that repeated hour.',
    );
  return new Date([...candidates][0]).toISOString();
}
