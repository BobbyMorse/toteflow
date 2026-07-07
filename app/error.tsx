"use client";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ToteFlow page error]", error);
  }, [error]);

  return (
    <div className="py-10 max-w-2xl">
      <div className="panel p-6 space-y-4">
        <h1 className="text-xl font-display font-semibold text-accent-steam">Page error</h1>
        <p className="text-sm text-ink-1">
          Something threw while rendering. If this happened right after a code change,
          it's usually a stale browser tab — refresh the page and it should clear.
        </p>
        <pre className="text-[11px] font-mono bg-bg-1 p-3 rounded overflow-x-auto text-ink-2">
          {error.message}
          {error.digest && `\n\nDigest: ${error.digest}`}
        </pre>
        <div className="flex gap-2">
          <button onClick={reset}
            className="px-3 py-1.5 rounded-md text-sm font-semibold border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan hover:brightness-110">
            Try again
          </button>
          <a href="/tickets"
            className="px-3 py-1.5 rounded-md text-sm border border-line text-ink-1 hover:text-ink-0">
            Reload tickets
          </a>
        </div>
      </div>
    </div>
  );
}
