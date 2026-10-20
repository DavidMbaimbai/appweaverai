'use client';

export default function OperationsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
        The operations dashboard could not be loaded.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-white">
        Try again
      </button>
    </div>
  );
}
