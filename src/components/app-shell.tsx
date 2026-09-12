'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpRight, Boxes, Compass, Inbox, Leaf, LogOut, Plus, UserRound } from 'lucide-react';
import { useApp } from './app-provider';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

const navigation = [
  { href: '/', label: 'Explore', icon: Compass },
  { href: '/share', label: 'Share', icon: Plus },
  { href: '/my-resources', label: 'My resources', icon: Boxes },
  { href: '/requests', label: 'Requests', icon: Inbox },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, configured } = useApp();
  const active = (href: string) =>
    href === '/' ? path === '/' || path.startsWith('/resources/') : path.startsWith(href);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand" aria-label="ResourceDex home">
            <span className="brand-mark">
              <Boxes size={22} strokeWidth={1.7} />
            </span>
            <span>
              resource<span className="brand-light">dex</span>
              <span className="brand-dot">.</span>
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {navigation
              .filter((item) => item.href !== '/share')
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active(item.href) ? 'nav-link active' : 'nav-link'}
                  aria-current={active(item.href) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
          </nav>
          <div className="header-actions">
            <Link href="/share" className="button primary header-share">
              <Plus size={17} /> Share a resource
            </Link>
            {user ? (
              <details className="account-menu">
                <summary className="avatar" aria-label="Account menu">
                  {String(user.user_metadata?.display_name || user.email || 'You')
                    .slice(0, 1)
                    .toUpperCase()}
                </summary>
                <div className="account-dropdown">
                  <strong>{user.user_metadata?.display_name || 'Your account'}</strong>
                  <Link href="/account">
                    Account settings <UserRound size={15} />
                  </Link>
                  <button
                    onClick={async () => {
                      await createBrowserSupabaseClient().auth.signOut();
                      router.push('/');
                      router.refresh();
                    }}
                  >
                    Sign out <LogOut size={15} />
                  </button>
                </div>
              </details>
            ) : (
              <Link className="sign-in" href={`/account?next=${encodeURIComponent(path)}`}>
                Sign in <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </div>
      </header>
      {!configured && (
        <div className="setup-ribbon">
          Interface preview · Sample resources only. Connect Supabase to share and request.
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <span>
          <Leaf size={15} /> A little less waste. A lot more possibility.
        </span>
        <div>
          <Link href="/about">How it works</Link>
          <Link href="/privacy">Privacy & community</Link>
          <span>ResourceDex · Pilot</span>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={active(item.href) ? 'active' : ''}
            aria-current={active(item.href) ? 'page' : undefined}
          >
            <item.icon size={21} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
