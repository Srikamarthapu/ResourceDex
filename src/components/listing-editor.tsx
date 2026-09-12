'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Crop, Info, Save } from 'lucide-react';
import type { Area, Category, Resource } from '@/lib/types';
import { categories, categoryLabels, conditionLabels } from '@/lib/types';
import { useResourceDraft } from '@/lib/use-resource-draft';
import { validatePublication } from '@/lib/resource-validation';
import { createListingImage, getScan } from '@/lib/scan-client';
import { validItemBounds } from '@/lib/images/geometry';
import { errorMessage } from '@/lib/format';
import { ResourceCard } from './resource-card';
import { Notice } from './ui';

export function ListingEditor({
  resource,
  areas,
  imageUrl,
  onImage,
  onSaved,
  onReview,
  registerSave,
  batchAreaHint,
}: {
  resource: Resource;
  areas: Area[];
  imageUrl: string | null;
  onImage: (url: string) => void;
  onSaved: (resource: Resource) => void | Promise<void>;
  onReview: (resource: Resource) => void;
  registerSave: (save: () => Promise<Resource>) => void;
  batchAreaHint?: string;
}) {
  const { value, change, status, error, save } = useResourceDraft(resource, onSaved, {
    autoSave: resource.status !== 'available',
  });
  const [approvedContent, setApprovedContent] = useState('');
  const editingPublished = resource.status === 'available';
  const approved = approvedContent === JSON.stringify(value);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  useEffect(() => {
    registerSave(save);
  }, [registerSave, save]);
  async function review(event: FormEvent) {
    event.preventDefault();
    if (editingPublished && !approved) {
      setLocalError('Review and confirm your changes before saving them publicly.');
      return;
    }
    const invalid = validatePublication(value);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(Object.keys(invalid)[0])?.focus();
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      onReview(await save());
    } catch (failure) {
      setLocalError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function applyCrop(reset = false) {
    if (!resource.scan_id) return;
    if (
      !reset &&
      (crop.x + crop.width > 100 ||
        crop.y + crop.height > 100 ||
        crop.width <= 0 ||
        crop.height <= 0)
    ) {
      setLocalError('Keep the crop within the photo, with positive width and height.');
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      const image = await createListingImage(
        resource.scan_id,
        reset
          ? undefined
          : {
              x_min: Math.round(crop.x * 10),
              y_min: Math.round(crop.y * 10),
              x_max: Math.round((crop.x + crop.width) * 10),
              y_max: Math.round((crop.y + crop.height) * 10),
            },
      );
      change({ image_path: image.imagePath });
      onImage(image.imageUrl);
      if (reset) setCrop({ x: 0, y: 0, width: 100, height: 100 });
    } catch (failure) {
      setLocalError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function applyDetectedCrop() {
    if (!resource.scan_id || !resource.candidate_id) return;
    setBusy(true);
    setLocalError('');
    try {
      const scan = await getScan(resource.scan_id);
      const bounds = validItemBounds(
        scan.candidates.find((candidate) => candidate.candidate_id === resource.candidate_id)
          ?.bounds,
      );
      if (!bounds)
        throw new Error(
          'This item has no saved detection box. Adjust the crop manually or use the full photo.',
        );
      const image = await createListingImage(resource.scan_id, bounds);
      change({ image_path: image.imagePath });
      onImage(image.imageUrl);
      setCrop({
        x: bounds.x_min / 10,
        y: bounds.y_min / 10,
        width: (bounds.x_max - bounds.x_min) / 10,
        height: (bounds.y_max - bounds.y_min) / 10,
      });
    } catch (failure) {
      setLocalError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const fieldError = (name: string) =>
    errors[name] ? (
      <span className="field-error" id={`${name}-error`}>
        {errors[name]}
      </span>
    ) : null;
  return (
    <form onSubmit={review}>
      <div className="listing-editor">
        <div className="form-card">
          <div className="form-section-title">
            <h2>The useful details</h2>
            <span className="save-status" role="status">
              {status === 'saved' ? (
                <>
                  <Check size={12} />
                  Saved
                </>
              ) : status === 'saving' ? (
                'Saving…'
              ) : status === 'failed' ? (
                'Couldn’t save'
              ) : (
                'Unsaved changes'
              )}
            </span>
          </div>
          {(error || localError) && (
            <Notice error>
              {error || localError}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  void save().catch(() => {});
                }}
              >
                Retry save
              </button>
            </Notice>
          )}
          <div className="form-field">
            <label htmlFor="title">Resource title</label>
            <input
              id="title"
              required
              minLength={3}
              maxLength={80}
              value={value.title}
              onChange={(event) => change({ title: event.target.value })}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'title-error' : undefined}
              placeholder="For example, a box of wood offcuts"
            />
            {fieldError('title')}
          </div>
          <div className="form-field">
            <label htmlFor="category">Category</label>
            <select
              id="category"
              value={value.category}
              onChange={(event) =>
                change({
                  category: event.target.value as Category,
                  working_status: event.target.value === 'tools' ? 'not_tested' : 'not_applicable',
                })
              }
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {categoryLabels[category]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="description">What’s included?</label>
            <textarea
              id="description"
              required
              minLength={10}
              maxLength={1000}
              value={value.description}
              onChange={(event) => change({ description: event.target.value })}
              placeholder="Describe what you’re sharing, and mention anything the next owner should know."
              aria-invalid={Boolean(errors.description)}
            />
            {fieldError('description')}
            <span className="field-hint">
              Keep exact addresses and private contact details out of this public description.
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="quantity-type">Are you sharing pieces or one lot?</label>
            <select
              id="quantity-type"
              value={value.lot_label !== null ? 'lot' : 'pieces'}
              onChange={(event) =>
                change(
                  event.target.value === 'lot'
                    ? { lot_label: 'One lot', quantity: null }
                    : { lot_label: null, quantity: 1 },
                )
              }
            >
              <option value="lot">One lot — count may be unknown</option>
              <option value="pieces">A known number of pieces</option>
            </select>
          </div>
          {value.lot_label !== null ? (
            <div className="form-field">
              <label htmlFor="lot_label">Describe the lot</label>
              <input
                id="lot_label"
                value={value.lot_label}
                maxLength={80}
                onChange={(event) => change({ lot_label: event.target.value })}
                placeholder="One box of assorted offcuts"
              />
              {fieldError('quantity')}
            </div>
          ) : (
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="quantity">Quantity</label>
                <input
                  id="quantity"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={value.quantity ?? ''}
                  onChange={(event) =>
                    change({ quantity: event.target.value ? Number(event.target.value) : null })
                  }
                />
                {fieldError('quantity')}
              </div>
              <div className="form-field">
                <label htmlFor="unit">Unit</label>
                <input
                  id="unit"
                  value={value.unit}
                  maxLength={40}
                  onChange={(event) => change({ unit: event.target.value })}
                  placeholder="pieces, boards, tools…"
                />
              </div>
            </div>
          )}
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="condition">Condition, per owner</label>
              <select
                id="condition"
                value={value.condition}
                onChange={(event) =>
                  change({ condition: event.target.value as Resource['condition'] })
                }
              >
                {Object.entries(conditionLabels).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="material">
                Material <span>(if known)</span>
              </label>
              <input
                id="material"
                maxLength={100}
                value={value.material}
                onChange={(event) => change({ material: event.target.value })}
                placeholder="Unknown is okay"
              />
            </div>
          </div>
          {value.category === 'tools' && (
            <div className="form-field">
              <label htmlFor="working_status">Working status, per owner</label>
              <select
                id="working_status"
                value={
                  value.working_status === 'not_applicable' ? 'not_tested' : value.working_status
                }
                onChange={(event) =>
                  change({ working_status: event.target.value as Resource['working_status'] })
                }
              >
                <option value="not_tested">Not tested</option>
                <option value="working">Working, per owner</option>
                <option value="not_working">Not working, per owner</option>
              </select>
              {fieldError('working_status')}
            </div>
          )}
          <div className="form-field">
            <label htmlFor="dimensions">
              Measurements <span>(optional, include units)</span>
            </label>
            <input
              id="dimensions"
              maxLength={120}
              value={value.dimensions}
              onChange={(event) => change({ dimensions: event.target.value })}
              placeholder="For example, 40 × 15 × 2 cm"
            />
            <span className="field-hint">
              Use measurements you’ve taken. Photo size doesn’t establish dimensions.
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="area_id">Public pickup area</label>
            <select
              id="area_id"
              required
              value={value.area_id}
              onChange={(event) => change({ area_id: event.target.value })}
            >
              <option value="">Choose a city or neighborhood</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.label}
                </option>
              ))}
            </select>
            {fieldError('area_id')}
            {batchAreaHint && <span className="field-hint">{batchAreaHint}</span>}
            <span className="field-hint">
              A broad area is all you need. Meeting details are shared privately after you accept a
              request.
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="image_alt">Photo description</label>
            <input
              id="image_alt"
              required
              minLength={3}
              maxLength={300}
              value={value.image_alt}
              onChange={(event) => change({ image_alt: event.target.value })}
              placeholder="Describe what’s visible in the photo"
            />
            {fieldError('image_alt')}
            <span className="field-hint">
              This helps people using screen readers understand your photo.
            </span>
          </div>
        </div>
        <aside className="editor-preview">
          <p>Public card preview</p>
          <ResourceCard
            resource={{ ...resource, ...value, status: 'available' }}
            imageUrl={imageUrl}
            area={areas.find((area) => area.id === value.area_id)?.label || 'Choose a pickup area'}
            href="#photo-review"
          />
          {fieldError('image_path')}
          <p className="photo-caption" id="photo-review">
            <Info size={12} />
            Check everything visible in the background. Only publish a photo you’re comfortable
            sharing.
          </p>
          {resource.scan_id && (
            <details className="crop-controls">
              <summary className="text-link">
                <Crop size={14} />
                Adjust photo crop
              </summary>
              <p className="field-hint">
                Enter percentages of the original photo. The full photo is always an option.
              </p>
              <div className="form-row">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <div className="form-field" key={key}>
                    <label htmlFor={`crop-${key}`}>
                      {{ x: 'Left', y: 'Top', width: 'Width', height: 'Height' }[key]} (%)
                    </label>
                    <input
                      id={`crop-${key}`}
                      type="number"
                      min={key === 'width' || key === 'height' ? 1 : 0}
                      max={100}
                      value={crop[key]}
                      onChange={(event) =>
                        setCrop((previous) => ({ ...previous, [key]: Number(event.target.value) }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="share-buttons">
                {resource.candidate_id && !resource.candidate_id.startsWith('manual:') && (
                  <button
                    type="button"
                    className="button small"
                    disabled={busy}
                    onClick={applyDetectedCrop}
                  >
                    Use detected item crop
                  </button>
                )}
                <button
                  type="button"
                  className="button small"
                  disabled={busy}
                  onClick={() => applyCrop()}
                >
                  Apply crop
                </button>
                <button
                  type="button"
                  className="button small"
                  disabled={busy}
                  onClick={() => applyCrop(true)}
                >
                  Use full photo
                </button>
              </div>
            </details>
          )}
          <Notice>
            <Info size={16} />
            <span>
              Reference suggestions aren’t available yet. You can publish your reviewed description.
            </span>
          </Notice>
          <div className="sidebar-tip">
            <LeafNote />
            <h3>Unknown is a useful answer.</h3>
            <p>
              A photo can help describe what’s visible. It can’t confirm strength, composition,
              working condition, or safety.
            </p>
          </div>
        </aside>
      </div>
      <div className="editor-actions">
        {editingPublished && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) =>
                setApprovedContent(event.target.checked ? JSON.stringify(value) : '')
              }
            />
            I reviewed these changes and the public photo. Saving updates the public resource and
            cancels pending requests.
          </label>
        )}
        {!editingPublished && (
          <button
            className="button"
            type="button"
            disabled={busy || status === 'saving'}
            onClick={async () => {
              try {
                await save();
              } catch {
                /* Save status displays the error. */
              }
            }}
          >
            <Save size={14} />
            Save draft
          </button>
        )}
        <button
          className="button primary"
          type="submit"
          disabled={busy || (editingPublished && !approved)}
        >
          {busy
            ? 'Saving your review…'
            : editingPublished
              ? 'Save reviewed changes'
              : 'Review before publishing'}
          <ArrowRight size={15} />
        </button>
      </div>
    </form>
  );
}
function LeafNote() {
  return <Info size={21} strokeWidth={1.4} />;
}
