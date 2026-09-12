'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page-container empty-state">
      <h1>We couldn’t load this page.</h1>
      <p>Your saved resources are still in your account. Try loading again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
