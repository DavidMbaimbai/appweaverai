export function UserAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </main>
  );
}
