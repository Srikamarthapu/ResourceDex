'use client';

import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { errorMessage } from '@/lib/format';
import { Notice } from './ui';

export function AccountDeletionPanel() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get('deletion-password') ?? '');
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation }),
      });
      const result = await response.json();
      if (!response.ok) {
        setStarted(Boolean(result.deletionStarted));
        throw new Error(result.error || 'Account deletion could not finish. Try again.');
      }
      await createBrowserSupabaseClient().auth.signOut({ scope: 'local' });
      // A new document also clears private data held in mounted app components.
      window.location.replace('/account?deleted=1');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      const passwordInput = form.elements.namedItem('deletion-password');
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = '';
      setBusy(false);
    }
  }

  return (
    <section className="account-deletion" aria-label="Account deletion">
      {open ? (
        <>
          <h3 id="account-deletion-title">Delete this account?</h3>
          <p>
            This permanently removes your account, photos, drafts, listings, requests, and pickup
            details. Your listings and their requests disappear for other people too. Reservations
            you hold are released. This cannot be undone.
          </p>
          {error && <Notice error>{error}</Notice>}
          <form onSubmit={deleteAccount}>
            <div className="form-field">
              <label htmlFor="deletion-password">Confirm your password</label>
              <input
                id="deletion-password"
                name="deletion-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="deletion-confirmation">Type DELETE to confirm</label>
              <input
                id="deletion-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                disabled={busy}
              />
            </div>
            <div className="inline-form">
              <button className="button danger" disabled={busy || confirmation !== 'DELETE'}>
                <Trash2 size={15} />
                {busy
                  ? 'Deleting account…'
                  : started
                    ? 'Finish deleting account'
                    : 'Permanently delete account'}
              </button>
              {!started && (
                <button
                  type="button"
                  className="button ghost"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setConfirmation('');
                    setError('');
                  }}
                >
                  Keep my account
                </button>
              )}
            </div>
          </form>
        </>
      ) : (
        <button className="button ghost danger" onClick={() => setOpen(true)}>
          <Trash2 size={14} /> Delete account
        </button>
      )}
    </section>
  );
}
