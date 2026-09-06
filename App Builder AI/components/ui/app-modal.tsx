'use client';

import { cn } from '@/lib/utils';
import { useEffect } from 'react';

type AppModalBackdropProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  backdropClassName?: string;
};

export function AppModalBackdrop({
  open,
  onClose,
  children,
  className,
  panelClassName,
  backdropClassName,
}: AppModalBackdropProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={cn('fixed inset-0 z-50', className)} role="presentation">
      <button
        type="button"
        className={cn(
          'absolute inset-0 bg-black/55 backdrop-blur-[3px]',
          backdropClassName,
        )}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={cn('z-10', panelClassName)}
        onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
