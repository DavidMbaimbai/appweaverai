export default function OperationsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8" role="status" aria-busy="true" aria-label="Loading operations">
      <div className="h-7 w-64 animate-pulse rounded bg-app-surface" />
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-app-surface" />
        ))}
      </div>
      <div className="mt-4 h-64 animate-pulse rounded-xl bg-app-surface" />
    </div>
  );
}
