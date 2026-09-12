'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCheck,
  ImagePlus,
  Info,
  Leaf,
  LockKeyhole,
  PencilLine,
  Plus,
  ScanLine,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Area, Resource } from '@/lib/types';
import { categoryLabels } from '@/lib/types';
import { errorMessage, quantityLabel } from '@/lib/format';
import { createClientId } from '@/lib/client-id';
import { pickupAreaRecipients } from '@/lib/share-defaults';
import { validItemBounds } from '@/lib/images/geometry';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import {
  getResource,
  getResourceImageUrl,
  listAreas,
  publishResources,
  saveResource,
} from '@/lib/data/resources';
import {
  analyzeScan,
  createListingImage,
  getScan,
  uploadPhoto,
  type ScanPreview,
} from '@/lib/scan-client';
import { validatePublication } from '@/lib/resource-validation';
import { editableFields } from '@/lib/use-resource-draft';
import { useScanReview } from '@/lib/use-scan-review';
import { useApp } from './app-provider';
import { EmptyState, Loading, Notice, PageHeading } from './ui';
import { ListingEditor } from './listing-editor';
import { ResourceCard } from './resource-card';
import { LocalizedPhoto } from './localized-photo';
import { ReferenceNotes } from './reference-notes';

type Stage = 'photo' | 'items' | 'details' | 'preview' | 'published';

export function ShareView() {
  const { user, authLoading } = useApp();
  const params = useSearchParams();
  const [stage, setStage] = useState<Stage>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [scan, setScan] = useState<ScanPreview | null>(null);
  const {
    candidates,
    change: setCandidates,
    restore: restoreReview,
    save: saveReview,
    status: reviewStatus,
    error: reviewError,
  } = useScanReview();
  const [drafts, setDrafts] = useState<Resource[]>([]);
  const draftsRef = useRef<Resource[]>([]);
  const replaceDrafts = useCallback((rows: Resource[]) => {
    draftsRef.current = rows;
    setDrafts(rows);
  }, []);
  const [areas, setAreas] = useState<Area[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(Boolean(params.get('draft') || params.get('scan')));
  const mounted = useRef(true);
  const actionInFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadKey = useRef<string | null>(null);
  const analysisKey = useRef<string | null>(null);
  const manualDraftKey = useRef<string | null>(null);
  const publishKey = useRef<string | null>(null);
  const currentSave = useRef<(() => Promise<Resource>) | null>(null);
  const loadedKey = useRef('');
  const registerSave = useCallback((save: () => Promise<Resource>) => {
    currentSave.current = save;
  }, []);
  const onSaved = useCallback(
    async (saved: Resource) => {
      const remember = (row: Resource) =>
        replaceDrafts(draftsRef.current.map((item) => (item.id === row.id ? row : item)));
      remember(saved);
      if (draftsRef.current[0]?.id !== saved.id) return;
      // Empty areas are untouched defaults. Once saved, each item keeps its own
      // choice across reloads, including choices made before the first item.
      for (const item of pickupAreaRecipients(draftsRef.current, saved)) {
        if (!mounted.current) throw new Error('This editor is no longer active.');
        const updated = await saveResource(
          createBrowserSupabaseClient(),
          { ...editableFields(item), area_id: saved.area_id },
          item.id,
          item.revision,
        );
        if (mounted.current) remember(updated);
      }
    },
    [replaceDrafts],
  );
  const draftParam = params.get('draft') || '';
  const scanParam = params.get('scan') || '';
  const userId = user?.id;
  // Area loading is independent of route restoration and its idempotency key.
  // StrictMode may cancel an earlier effect; the replacement still fetches areas.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void listAreas(createBrowserSupabaseClient()).then(
      (rows) => {
        if (active) setAreas(rows);
      },
      (failure) => {
        if (active) setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const key = `${userId}:${draftParam}:${scanParam}`;
    if (loadedKey.current === key) return;
    let mounted = true;
    const load = async () => {
      try {
        const client = createBrowserSupabaseClient();
        if (draftParam) {
          const ids = draftParam.split(',').slice(0, 12);
          const rows = (await Promise.all(ids.map((id) => getResource(client, id)))).filter(
            (item): item is Resource => Boolean(item && item.owner_id === userId),
          );
          if (rows.length !== ids.length)
            throw new Error('This draft is unavailable in your account.');
          if (rows.some((item) => ['reserved', 'completed'].includes(item.status)))
            throw new Error(
              'Cancel the reservation before editing this resource. Collected resources stay in your history.',
            );
          const urls = Object.fromEntries(
            await Promise.all(
              rows.map(async (item) => [item.id, await getResourceImageUrl(client, item)]),
            ),
          );
          if (mounted) {
            replaceDrafts(rows);
            setImages(urls);
            setStage('details');
          }
        } else if (scanParam) {
          const existing = await getScan(scanParam);
          if (mounted) {
            setScan(existing);
            restoreReview(existing);
            setStage(existing.candidates.length ? 'items' : 'photo');
          }
        }
        if (mounted) loadedKey.current = key;
      } catch (failure) {
        if (mounted) setError(errorMessage(failure));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [userId, draftParam, scanParam, restoreReview, replaceDrafts]);
  useEffect(
    () => () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    },
    [filePreview],
  );
  function chooseFile(chosen?: File) {
    if (!chosen || actionInFlight.current) return;
    setError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) ||
      chosen.size > 10 * 1024 * 1024
    ) {
      setError('Choose a JPEG, PNG, or WebP photo up to 10 MB. Convert HEIC photos first.');
      return;
    }
    try {
      const operationKey = createClientId();
      const preview = URL.createObjectURL(chosen);
      setFile(chosen);
      setFilePreview(preview);
      setScan(null);
      restoreReview(null);
      uploadKey.current = operationKey;
      analysisKey.current = null;
      manualDraftKey.current = null;
      setConsent(false);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function ensurePhoto(): Promise<ScanPreview> {
    if (scan) return scan;
    if (!file) throw new Error('Choose a photo first.');
    uploadKey.current ||= createClientId();
    const uploaded = await uploadPhoto(file, uploadKey.current, setBusy);
    if (!mounted.current)
      throw new Error('Account changed. Your private photo remains in the original account.');
    setScan(uploaded);
    // The URL is a durable return point, including when identification fails.
    loadedKey.current = `${user?.id}:${''}:${uploaded.scanId}`;
    history.replaceState(null, '', `/share?scan=${uploaded.scanId}`);
    return uploaded;
  }
  async function identify() {
    if (actionInFlight.current) return;
    if (!consent) {
      setError(
        'Confirm that this photo may be sent to Google or the NVIDIA backup for identification.',
      );
      return;
    }
    actionInFlight.current = true;
    setError('');
    setBusy('Preparing photo');
    try {
      const ready = await ensurePhoto();
      if (ready.analysisVersion > 0) {
        await saveReview();
        if (!mounted.current) return;
        if (
          !window.confirm(
            'Start a new identification and a fresh item review? Your previous review remains saved.',
          )
        )
          return;
        analysisKey.current = createClientId();
      }
      setBusy('Identifying items');
      analysisKey.current ||= createClientId();
      const result = await analyzeScan(ready, analysisKey.current);
      if (!mounted.current) return;
      const complete = { ...ready, ...result };
      setScan(complete);
      restoreReview(complete);
      setStage('items');
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
      analysisKey.current = null;
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setBusy('');
    }
  }
  async function startDrafts(manual = false) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setError('');
    setBusy('Saving private drafts');
    try {
      const ready = await ensurePhoto();
      const reviewed = manual ? [] : await saveReview();
      if (!mounted.current) return;
      const selection = manual
        ? [
            {
              label: '',
              category: 'other' as const,
              visible_observations: [] as string[],
              bounds: null,
              candidate_id: (manualDraftKey.current ||= `manual:${createClientId()}`),
            },
          ]
        : reviewed.filter((item) => item.selected);
      if (!selection.length) throw new Error('Select at least one item or add one yourself.');
      const saved: Resource[] = [];
      const client = createBrowserSupabaseClient();
      let fullImage: Awaited<ReturnType<typeof createListingImage>> | undefined;
      // Separate durable drafts; only the later Publish command changes public visibility.
      for (const candidate of selection) {
        const existing = drafts.find(
          (item) => item.candidate_id && item.candidate_id === candidate.candidate_id,
        );
        if (existing) {
          saved.push(existing);
          continue;
        }
        const bounds = validItemBounds(candidate.bounds);
        const image = bounds
          ? await createListingImage(ready.scanId, bounds)
          : (fullImage ||= await createListingImage(ready.scanId));
        const row = await saveResource(client, {
          title: candidate.label,
          category: candidate.category,
          description: candidate.visible_observations.join(' '),
          quantity: null,
          unit: 'pieces',
          lot_label: 'One lot',
          condition: 'unknown',
          working_status: candidate.category === 'tools' ? 'not_tested' : 'not_applicable',
          material: 'Unknown',
          dimensions: '',
          area_id: '',
          image_path: image.imagePath,
          image_alt: candidate.label ? `Photo showing ${candidate.label.toLowerCase()}.` : '',
          scan_id: ready.scanId,
          candidate_id: candidate.candidate_id,
        });
        saved.push(row);
      }
      const imageUrls = Object.fromEntries(
        await Promise.all(
          saved.map(async (item) => [
            item.id,
            await getResourceImageUrl(createBrowserSupabaseClient(), item),
          ]),
        ),
      );
      if (!mounted.current) return;
      if (manual) manualDraftKey.current = null;
      replaceDrafts(saved);
      setImages(imageUrls);
      setActive(0);
      setStage('details');
      loadedKey.current = `${user?.id}:${saved.map((item) => item.id).join(',')}:`;
      history.replaceState(null, '', `/share?draft=${saved.map((item) => item.id).join(',')}`);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setBusy('');
    }
  }
  async function switchDraft(index: number) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    try {
      await currentSave.current?.();
      setActive(index);
      setError('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      actionInFlight.current = false;
    }
  }
  function reviewAll(saved: Resource) {
    const latest = draftsRef.current.map((item) => (item.id === saved.id ? saved : item));
    replaceDrafts(latest);
    if (saved.status === 'available') {
      setStage('published');
      setError('');
      return;
    }
    const incomplete = latest.findIndex(
      (item) => Object.keys(validatePublication(editableFields(item))).length,
    );
    if (incomplete >= 0) {
      setActive(incomplete);
      setError(
        `Finish the required details for “${latest[incomplete].title || 'Untitled resource'}” before reviewing publication.`,
      );
      return;
    }
    setStage('preview');
    setConfirmed(false);
    setError('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async function publish() {
    if (!confirmed || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy('Publishing resources');
    setError('');
    try {
      publishKey.current ||= createClientId();
      await publishResources(
        createBrowserSupabaseClient(),
        drafts.map((item) => item.id),
        publishKey.current,
        Object.fromEntries(drafts.map((item) => [item.id, item.revision])),
      );
      if (!mounted.current) return;
      setStage('published');
      history.replaceState(null, '', '/share');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setBusy('');
    }
  }
  if (authLoading || (user && loading)) return <Loading label="Loading your saved work" />;
  if (!user)
    return (
      <div className="page-container share-container">
        <PageHeading eyebrow="Share a little possibility" title="What’s waiting in your workshop?">
          Turn spare materials into someone’s next project.
        </PageHeading>
        <EmptyState
          title="Your next share starts with a photo"
          href="/account?next=/share"
          action="Sign in to share"
        >
          Sign in to keep your photos and drafts private until you’re ready to publish.
        </EmptyState>
      </div>
    );
  if (stage === 'published')
    return (
      <div className="page-container share-container">
        <EmptyState
          title={
            drafts.every((item) => item.status === 'available')
              ? 'Your resource has been updated.'
              : `${drafts.length === 1 ? 'Your resource is' : 'Your resources are'} out in the world.`
          }
          href="/my-resources"
          action="View my resources"
        >
          {drafts.length} {drafts.length === 1 ? 'resource is' : 'resources are'} published. Other
          people can now find them in Explore and send a pickup request.
        </EmptyState>
        <div className="resource-grid">
          {drafts.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={{ ...resource, status: 'available' }}
              imageUrl={images[resource.id]}
              area={areas.find((area) => area.id === resource.area_id)?.label || ''}
            />
          ))}
        </div>
        <div className="share-buttons">
          <Link href="/" className="button">
            See them in Explore <ArrowRight size={14} />
          </Link>
          <button
            className="button primary"
            onClick={() => {
              setStage('photo');
              setFile(null);
              setFilePreview('');
              setScan(null);
              restoreReview(null);
              manualDraftKey.current = null;
              analysisKey.current = null;
              uploadKey.current = null;
              setConsent(false);
              replaceDrafts([]);
              publishKey.current = null;
            }}
          >
            Share another resource <Plus size={14} />
          </button>
        </div>
      </div>
    );
  return (
    <div className="page-container share-container">
      <PageHeading
        eyebrow="Good things deserve another chapter"
        title={
          stage === 'photo'
            ? 'What will you share?'
            : stage === 'items'
              ? 'A good start. Your say.'
              : stage === 'preview'
                ? 'Ready for a second beginning.'
                : 'Make it yours. Make it clear.'
        }
      >
        {stage === 'photo'
          ? 'Start with a photo. You decide what gets shared.'
          : stage === 'items'
            ? 'Review what’s visible, correct the details, and choose the items to share.'
            : stage === 'preview'
              ? 'This is what others will see. Nothing is public until you publish.'
              : drafts[active]?.status === 'available'
                ? 'Review your changes before saving them to the public listing.'
                : 'Review every detail. Your drafts save privately as you work.'}
      </PageHeading>
      <div className="stepper" aria-label="Sharing steps">
        <span className={`step ${stage === 'photo' ? 'active' : ''}`}>Add a photo</span>
        <span className={`step ${['items', 'details'].includes(stage) ? 'active' : ''}`}>
          Review & describe
        </span>
        <span className={`step ${stage === 'preview' ? 'active' : ''}`}>Publish</span>
      </div>
      {error && (
        <div className="notice-stack">
          <Notice error>{error}</Notice>
        </div>
      )}
      {stage === 'photo' && (
        <div className="share-layout">
          <section>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => chooseFile(event.target.files?.[0])}
              aria-label="Choose a resource photo"
            />
            <input
              ref={cameraInput}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => chooseFile(event.target.files?.[0])}
              aria-label="Take a resource photo"
            />
            {scan?.imageUrl || filePreview ? (
              <div className="upload-preview">
                <img
                  src={scan?.imageUrl || filePreview}
                  alt="Your selected photo, kept private until publication"
                />
                <div className="image-toolbar">
                  <button
                    disabled={Boolean(busy)}
                    className="button small"
                    onClick={() => fileInput.current?.click()}
                  >
                    <ImagePlus size={14} />
                    Replace photo
                  </button>
                  <button
                    disabled={Boolean(busy)}
                    className="button small"
                    onClick={() => {
                      setFile(null);
                      setFilePreview('');
                      setScan(null);
                      restoreReview(null);
                      manualDraftKey.current = null;
                      analysisKey.current = null;
                      uploadKey.current = null;
                      setConsent(false);
                      history.replaceState(null, '', '/share');
                    }}
                  >
                    <X size={14} />
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="upload-area"
                style={{ width: '100%' }}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={34} strokeWidth={1.2} />
                <h2>A photo full of possibility.</h2>
                <p>
                  Photograph the materials you want to share.
                  <br />
                  Keep each item visible.
                </p>
                <span className="button primary">
                  <Plus size={15} />
                  Choose a photo
                </span>
                <span className="field-hint">JPEG, PNG, or WebP · Up to 10 MB</span>
              </button>
            )}
            <div className="share-buttons">
              <button
                className="button"
                onClick={() => cameraInput.current?.click()}
                disabled={Boolean(busy)}
              >
                <Camera size={15} />
                Use camera
              </button>
              {scan && (
                <span className="save-status">
                  <LockKeyhole size={12} />
                  Photo saved privately
                </span>
              )}
            </div>
            <div className="share-disclosure">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                Send this photo to Google Gemini, or Kimi K3 on NVIDIA if Gemini is unavailable, to
                help identify items. I’ll review and correct every suggestion.
              </label>
              <p className="field-hint">Backup identification may take a minute or more.</p>
            </div>
            <div className="share-buttons">
              <button
                className="button primary"
                disabled={Boolean(busy) || (!file && !scan) || !consent}
                onClick={identify}
              >
                <ScanLine size={16} />
                {busy || 'Identify items'}
              </button>
              <button
                className="button"
                disabled={Boolean(busy) || (!file && !scan)}
                onClick={() => startDrafts(true)}
              >
                <PencilLine size={15} />
                Add details myself
              </button>
            </div>
            <p className="share-disclosure">
              Only approved listing photos and fields become public when you publish. Photos stay
              private until you publish. Ask the pilot operator if you need an upload removed.
            </p>
          </section>
          <aside className="share-sidebar">
            <h2>A better photo. A better start.</h2>
            <div className="share-tips">
              <div className="share-tip">
                <span>
                  <Camera size={16} />
                </span>
                <div>
                  <h3>Let the materials take the spotlight</h3>
                  <p>
                    Use natural light and a clear background. Keep personal details, people, and
                    addresses out of the frame.
                  </p>
                </div>
              </div>
              <div className="share-tip">
                <span>
                  <ScanLine size={16} />
                </span>
                <div>
                  <h3>One photo can become several listings</h3>
                  <p>
                    Lay out distinct items so they’re easy to see. A box of small parts can stay
                    together as one lot.
                  </p>
                </div>
              </div>
              <div className="share-tip">
                <span>
                  <CheckCheck size={16} />
                </span>
                <div>
                  <h3>Your review makes the difference</h3>
                  <p>
                    Identification is a starting point. You can rename, remove, or add items and
                    leave uncertain details unknown.
                  </p>
                </div>
              </div>
              <div className="share-tip">
                <span>
                  <Leaf size={16} />
                </span>
                <div>
                  <h3>Useful, ordinary materials only</h3>
                  <p>
                    Share solid materials, parts, and tools for free. Chemicals, hazardous waste,
                    and regulated items are outside this pilot.
                  </p>
                </div>
              </div>
            </div>
            <div className="sidebar-tip">
              <LockKeyhole size={20} />
              <h3>You choose what becomes public.</h3>
              <p>Uploading a photo or saving a draft never publishes a resource.</p>
            </div>
          </aside>
        </div>
      )}
      {stage === 'items' && scan && (
        <>
          {scan.analysisModel?.startsWith('moonshotai/') && (
            <Notice>
              Kimi K3 identified these items because Gemini was unavailable. Review each suggestion
              before continuing.
            </Notice>
          )}
          {scan.referenceStatus === 'unavailable' && (
            <Notice>
              Item identification is ready, but the reuse reference lookup could not finish.
            </Notice>
          )}
          {scan.referenceStatus === 'no_evidence' && (
            <Notice>
              No matching reuse references were found in the current starter collection.
            </Notice>
          )}
          <div className="share-layout">
            <div>
              {candidates[active] && (
                <>
                  <LocalizedPhoto
                    src={scan.imageUrl}
                    alt={`Item ${active + 1}: ${candidates[active].label || 'Unnamed item'}`}
                    bounds={candidates[active].bounds}
                    width={scan.width}
                    height={scan.height}
                  />
                  <p className="photo-caption">
                    Item {active + 1}: {candidates[active].label || 'Unnamed item'}
                    {validItemBounds(candidates[active].bounds)
                      ? ' · Suggested crop'
                      : ' · Full photo'}
                  </p>
                </>
              )}
              <details>
                <summary className="text-link">See full photo and all items</summary>
                <div className="review-image">
                  <img src={scan.imageUrl} alt="Your materials with numbered review boxes" />
                  {candidates.map(
                    (candidate, index) =>
                      validItemBounds(candidate.bounds) &&
                      candidate.bounds && (
                        <button
                          key={candidate.candidate_id}
                          className={`image-box ${active === index ? 'active' : ''}`}
                          style={{
                            left: `${candidate.bounds.x_min / 10}%`,
                            top: `${candidate.bounds.y_min / 10}%`,
                            width: `${(candidate.bounds.x_max - candidate.bounds.x_min) / 10}%`,
                            height: `${(candidate.bounds.y_max - candidate.bounds.y_min) / 10}%`,
                          }}
                          aria-label={`Review item ${index + 1}: ${candidate.label}`}
                          onClick={() => {
                            setActive(index);
                            document.getElementById(`candidate-${index}`)?.focus();
                          }}
                        >
                          <span>{index + 1}</span>
                        </button>
                      ),
                  )}
                </div>
              </details>
              <p className="photo-caption">
                <Info size={12} />
                Suggested identities, not verified material or condition.
              </p>
              {scan.limitReached && (
                <Notice>
                  The photo reached the 12-item limit. Some items may be missing; try a second
                  photo.
                </Notice>
              )}
            </div>
            <div className="candidate-list">
              {!candidates.length && (
                <Notice>
                  No clearly identifiable materials were found. Add an item yourself to continue.
                </Notice>
              )}
              {candidates.map((candidate, index) => (
                <div
                  className={`candidate ${candidate.selected ? 'selected' : ''}`}
                  key={candidate.candidate_id}
                >
                  <input
                    type="checkbox"
                    checked={candidate.selected}
                    aria-label={`Include ${candidate.label}`}
                    onChange={(event) =>
                      setCandidates((previous) =>
                        previous.map((item, position) =>
                          position === index ? { ...item, selected: event.target.checked } : item,
                        ),
                      )
                    }
                  />
                  <div className="candidate-content">
                    <span className="candidate-number">{index + 1}</span>
                    <label className="visually-hidden" htmlFor={`candidate-${index}`}>
                      Item {index + 1} name
                    </label>
                    <input
                      id={`candidate-${index}`}
                      type="text"
                      value={candidate.label}
                      maxLength={80}
                      onFocus={() => setActive(index)}
                      onChange={(event) =>
                        setCandidates((previous) =>
                          previous.map((item, position) =>
                            position === index
                              ? { ...item, label: event.target.value, reference_notes: undefined }
                              : item,
                          ),
                        )
                      }
                    />
                    <p>{candidate.visible_observations.join(' ')}</p>
                    <label className="field-hint" htmlFor={`candidate-category-${index}`}>
                      Category
                    </label>
                    <select
                      id={`candidate-category-${index}`}
                      value={candidate.category}
                      onChange={(event) =>
                        setCandidates((previous) =>
                          previous.map((item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  category: event.target.value as typeof item.category,
                                  reference_notes: undefined,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      {Object.entries(categoryLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {candidate.unknowns.length > 0 && <p>{candidate.unknowns.join(' · ')}</p>}
                    {!candidate.bounds && (
                      <p>Location needs review. The full photo can still be used.</p>
                    )}
                    <ReferenceNotes notes={candidate.reference_notes} />
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${candidate.label}`}
                    onClick={() =>
                      setCandidates((previous) =>
                        previous.filter((item) => item.candidate_id !== candidate.candidate_id),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                className="button"
                disabled={Boolean(busy) || candidates.length >= 12}
                onClick={() =>
                  setCandidates((previous) => [
                    ...previous,
                    {
                      candidate_id: `manual:${createClientId()}`,
                      label: '',
                      category: 'other',
                      bounds: null,
                      localization_status: 'manual_unlocalized',
                      localization_reason: 'Added by you. Choose an approved photo or crop.',
                      visible_observations: [],
                      unknowns: ['Material, dimensions and condition have not been confirmed.'],
                      owner_questions: [],
                      review_status: 'corrected',
                      source: 'manual',
                      selected: true,
                    },
                  ])
                }
              >
                <Plus size={14} />
                Add an item myself
              </button>
            </div>
          </div>
          <div className="save-status" role="status">
            {reviewStatus === 'saved'
              ? 'Item review saved privately'
              : reviewStatus === 'saving'
                ? 'Saving item review…'
                : reviewStatus === 'failed'
                  ? 'Item review not saved'
                  : 'Unsaved item corrections'}
          </div>
          {reviewError && (
            <Notice error>
              {reviewError}{' '}
              <button className="text-button" onClick={() => void saveReview().catch(() => {})}>
                Retry save
              </button>
            </Notice>
          )}
          <div className="editor-actions">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={async () => {
                try {
                  await saveReview();
                  setStage('photo');
                } catch (failure) {
                  setError(errorMessage(failure));
                }
              }}
            >
              <ArrowLeft size={14} />
              Back to photo
            </button>
            <button
              className="button primary"
              disabled={Boolean(busy) || !candidates.some((item) => item.selected)}
              onClick={() => startDrafts()}
            >
              {busy || `Continue with ${candidates.filter((item) => item.selected).length} items`}
              <ArrowRight size={15} />
            </button>
          </div>
        </>
      )}
      {stage === 'details' && drafts[active] && (
        <>
          {drafts.length > 1 && (
            <div className="tabs" aria-label="Selected item drafts">
              {drafts.map((item, index) => (
                <button
                  className={`tab ${active === index ? 'active' : ''}`}
                  key={item.id}
                  onClick={() => switchDraft(index)}
                >
                  {index + 1}. {item.title || 'Untitled resource'}
                </button>
              ))}
            </div>
          )}
          <ListingEditor
            key={drafts[active].id}
            resource={drafts[active]}
            areas={areas}
            imageUrl={images[drafts[active].id]}
            onImage={(url) => setImages((previous) => ({ ...previous, [drafts[active].id]: url }))}
            onSaved={onSaved}
            onReview={reviewAll}
            registerSave={registerSave}
            batchAreaHint={
              drafts.length > 1 && drafts[active].status === 'draft'
                ? active === 0
                  ? 'Used for items that don’t have a pickup area yet. You can change each item separately.'
                  : 'Starts with the first item’s pickup area. Change it here if this item is elsewhere.'
                : undefined
            }
          />
        </>
      )}
      {stage === 'preview' && (
        <>
          <div className="publication-grid">
            {drafts.map((item) => (
              <div className="publication-card" key={item.id}>
                <ResourceCard
                  resource={{ ...item, status: 'available' }}
                  imageUrl={images[item.id]}
                  area={areas.find((area) => area.id === item.area_id)?.label || ''}
                  href="#publication-confirm"
                />
                <p>{item.description}</p>
                <dl>
                  <div>
                    <dt>Quantity</dt>
                    <dd>{quantityLabel(item)}</dd>
                  </div>
                  <div>
                    <dt>Material</dt>
                    <dd>{item.material || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Measurements</dt>
                    <dd>{item.dimensions || 'Not provided'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div className="form-card" id="publication-confirm" style={{ marginTop: 30 }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I reviewed every resource’s details and public photo, including the background. I
                own these materials, they are within the pilot’s scope, and the whole listing is
                available to give away for free.
              </span>
            </label>
            <p className="field-hint">
              Publishing makes these photos, descriptions, your display name, and the selected
              pickup areas visible to everyone. Precise pickup details remain private.
            </p>
          </div>
          <div className="editor-actions">
            <button className="button" onClick={() => setStage('details')} disabled={Boolean(busy)}>
              <ArrowLeft size={14} />
              Keep editing
            </button>
            <button
              className="button primary"
              disabled={Boolean(busy) || !confirmed}
              onClick={publish}
            >
              {busy || `Publish ${drafts.length} ${drafts.length === 1 ? 'resource' : 'resources'}`}
              <ArrowRight size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
