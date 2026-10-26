"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page-loading">
      <h1>We couldn’t load this page.</h1>
      <p>
        Please try again. If this continues, ask the administrator to check the
        application configuration.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
