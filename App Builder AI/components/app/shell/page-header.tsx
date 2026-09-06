import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  children?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, children, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex h-app-topbar shrink-0 items-center justify-between gap-4 border-b border-app-border-subtle px-6',
        className,
      )}>
      <h1 className="font-display text-xl text-app-text">{title}</h1>
      {children}
    </header>
  );
}
