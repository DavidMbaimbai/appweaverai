export function AgentBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full bg-[#FF3C00] px-3.5 text-sm font-medium text-[#FAF6F1] ${className ?? ''}`}
      aria-hidden="true">
      App Weaver AI
    </span>
  );
}
