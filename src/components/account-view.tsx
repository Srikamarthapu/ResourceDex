'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Boxes, Camera, Check, Leaf, LockKeyhole, LogOut } from 'lucide-react';
import { useApp } from './app-provider';
import { Loading, Notice } from './ui';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { errorMessage } from '@/lib/format';

type AuthMode = 'signin' | 'signup' | 'recover' | 'update';
export function AccountView() {
  const { user, configured, authLoading } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(params.get('mode') === 'update' ? 'update' : 'signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const rawNext = params.get('next') || '/';
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\') ? rawNext : '/';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get('email') || '').trim();
      const password = String(form.get('password') || '');
      const client = createBrowserSupabaseClient();
      if (mode === 'signup') {
        const { error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: String(form.get('name') || '').trim() },
            emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setMessage('Check your email to verify your account, then come back to sign in.');
      } else if (mode === 'recover') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/callback?next=/account?mode=update`,
        });
        if (error) throw error;
        setMessage('If an account exists for that email, a recovery link is on its way.');
      } else if (mode === 'update') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setMessage('Your password has been updated.');
        setMode('signin');
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    signin: 'Welcome back.',
    signup: 'Make room for possibility.',
    recover: 'Let’s get you back in.',
    update: 'Choose a new password.',
  };
  if (authLoading) return <Loading label="Checking your account" />;
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">
          <Leaf size={13} /> A community with something to share
        </p>
        <h1>
          Your extras.
          <br />
          Someone’s
          <br />
          next idea.
        </h1>
        <p>
          A few offcuts. A spare tool. A box of possibilities. Find useful things and help yours
          find their next home.
        </p>
        <div className="auth-feature">
          <span>
            <Camera size={17} />
          </span>
          Share a photo. Create a resource.
        </div>
        <div className="auth-feature">
          <span>
            <Boxes size={17} />
          </span>
          Find materials for your next project.
        </div>
        <div className="auth-feature">
          <span>
            <LockKeyhole size={16} />
          </span>
          Keep pickup details between you.
        </div>
      </section>
      <section className="auth-card">
        {user && mode !== 'update' ? (
          <>
            <h2>Hello, {user.user_metadata?.display_name || 'neighbor'}.</h2>
            <p>You’re signed in. Your drafts, resources, and requests live in this account.</p>
            {!user.email_confirmed_at && (
              <Notice>Verify your email before sharing or requesting resources.</Notice>
            )}
            <div className="inline-form">
              <Link href="/my-resources" className="button primary">
                My resources <ArrowRight size={15} />
              </Link>
              <Link href="/requests" className="button">
                My requests
              </Link>
              <button
                className="button ghost"
                onClick={async () => {
                  await createBrowserSupabaseClient().auth.signOut();
                }}
              >
                Sign out <LogOut size={14} />
              </button>
            </div>
            <p className="auth-fineprint">
              For pilot account deletion, contact your pilot organizer.{' '}
              <Link href="/privacy">Read the data-handling notice.</Link>
            </p>
          </>
        ) : (
          <>
            <h2>{titles[mode]}</h2>
            <p>
              {mode === 'signup'
                ? 'Create an account to share and request free resources.'
                : mode === 'recover'
                  ? 'We’ll send a password reset link to your email.'
                  : mode === 'update'
                    ? 'Use at least 10 characters for your new password.'
                    : 'Sign in to give good materials a second beginning.'}
            </p>
            <div className="notice-stack">
              {!configured && <Notice>Accounts are available once Supabase is connected.</Notice>}
              {error && <Notice error>{error}</Notice>}
              {message && (
                <Notice>
                  <Check size={16} />
                  {message}
                </Notice>
              )}
              {params.get('error') && (
                <Notice error>
                  The sign-in link expired or could not be verified. Request a new link.
                </Notice>
              )}
            </div>
            <form onSubmit={submit}>
              {mode === 'signup' && (
                <div className="form-field">
                  <label htmlFor="display-name">Display name</label>
                  <input
                    id="display-name"
                    name="name"
                    autoComplete="nickname"
                    required
                    minLength={2}
                    maxLength={50}
                    placeholder="What should neighbors call you?"
                  />
                </div>
              )}
              {mode !== 'update' && (
                <div className="form-field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </div>
              )}
              {mode !== 'recover' && (
                <div className="form-field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    required
                    minLength={mode === 'signin' ? 1 : 10}
                    maxLength={128}
                    placeholder={mode === 'signin' ? 'Your password' : 'At least 10 characters'}
                  />
                </div>
              )}
              {mode === 'signin' && (
                <button
                  type="button"
                  className="forgot-button"
                  onClick={() => {
                    setMode('recover');
                    setError('');
                    setMessage('');
                  }}
                >
                  Forgot password?
                </button>
              )}
              {mode === 'signup' && (
                <label className="checkbox-label">
                  <input required type="checkbox" />I agree to share only ordinary, safe materials
                  for free local pickup and to follow the community guidelines.
                </label>
              )}
              <button disabled={busy || !configured} className="button primary full" type="submit">
                {busy
                  ? 'Please wait…'
                  : mode === 'signin'
                    ? 'Sign in'
                    : mode === 'signup'
                      ? 'Create account'
                      : mode === 'update'
                        ? 'Update password'
                        : 'Send recovery link'}
                <ArrowRight size={16} />
              </button>
            </form>
            <div className="auth-switch">
              {mode === 'signin' ? (
                <>
                  New to the community?{' '}
                  <button
                    onClick={() => {
                      setMode('signup');
                      setError('');
                      setMessage('');
                    }}
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setMode('signin');
                    setError('');
                    setMessage('');
                  }}
                >
                  Back to sign in
                </button>
              )}
            </div>
            <p className="auth-fineprint">
              Your email stays private. Only your display name is shared.
              <br />
              <Link href="/privacy">Privacy & community guidelines</Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
