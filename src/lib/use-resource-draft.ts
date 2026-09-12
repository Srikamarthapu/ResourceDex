'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveResource, type ResourceSaveInput } from './data/resources';
import { createBrowserSupabaseClient } from './supabase/browser';
import { errorMessage } from './format';
import { createSaveQueue } from './data/save-queue';
import type { Resource } from './types';

export function editableFields(resource: Resource): ResourceSaveInput {
  return {
    title: resource.title,
    category: resource.category,
    description: resource.description,
    quantity: resource.quantity,
    unit: resource.unit,
    lot_label: resource.lot_label,
    condition: resource.condition,
    working_status: resource.working_status,
    material: resource.material,
    dimensions: resource.dimensions,
    area_id: resource.area_id || '',
    image_path: resource.image_path,
    image_alt: resource.image_alt,
  };
}

/** One save at a time; later edits never inherit an old revision or a false Saved label. */
export function useResourceDraft(
  initial: Resource,
  onSaved: (resource: Resource) => void,
  options: { autoSave?: boolean } = {},
) {
  const autoSave = options.autoSave ?? true;
  const [value, setValue] = useState(() => editableFields(initial));
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'failed'>('saved');
  const [error, setError] = useState('');
  const latest = useRef(value);
  const stored = useRef(JSON.stringify(value));
  const resource = useRef(initial);
  const queue = useRef(createSaveQueue());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  const change = useCallback((patch: Partial<ResourceSaveInput>) => {
    latest.current = { ...latest.current, ...patch };
    setValue(latest.current);
    setStatus('unsaved');
    setError('');
  }, []);
  const save = useCallback(
    (): Promise<Resource> =>
      queue.current.run(async () => {
        try {
          if (!mounted.current) throw new Error('This editor is no longer active.');
          if (JSON.stringify(latest.current) !== stored.current) {
            setStatus('saving');
            setError('');
          }
          const client = createBrowserSupabaseClient();
          const {
            data: { user },
            error: authError,
          } = await client.auth.getUser();
          if (authError || user?.id !== resource.current.owner_id) {
            throw new Error(
              'Your account changed or your session expired. Sign in and reopen this draft from My resources.',
            );
          }
          // Drain changes made while a write was in flight before allowing a caller
          // to leave the editor or open publication review.
          while (JSON.stringify(latest.current) !== stored.current) {
            if (!mounted.current) throw new Error('This editor is no longer active.');
            const snapshot = latest.current;
            const serialized = JSON.stringify(snapshot);
            setStatus('saving');
            setError('');
            const saved = await saveResource(
              client,
              snapshot,
              resource.current.id,
              resource.current.revision,
            );
            resource.current = saved;
            stored.current = serialized;
            if (mounted.current) onSavedRef.current(saved);
          }
          if (!mounted.current) throw new Error('This editor is no longer active.');
          setStatus('saved');
          setError('');
          return resource.current;
        } catch (failure) {
          if (mounted.current) {
            setStatus('failed');
            setError(errorMessage(failure));
          }
          throw failure;
        }
      }),
    [],
  );
  useEffect(() => {
    if (status !== 'unsaved' || !autoSave) return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [value, status, save, autoSave]);
  useEffect(() => {
    const unsaved = () => JSON.stringify(latest.current) !== stored.current;
    const onUnload = (event: BeforeUnloadEvent) => {
      if (unsaved()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onLink = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a');
      if (!link || link.target === '_blank' || !unsaved()) return;
      if (
        !window.confirm(
          'Your latest changes are not saved yet. Leave and discard those changes? Choose Cancel to stay and retry saving.',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onLink, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onLink, true);
    };
  }, []);
  return { value, change, status, error, save };
}
