import { cn } from '@/lib/utils';

type ContainerProps = {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'footer' | 'header' | 'nav';
  id?: string;
};

export function HeaderContainer({
  children,
  className,
  as: Tag = 'div',
  id,
}: ContainerProps) {
  return (
    <div className="mx-auto max-w-page-header desktop:grid desktop:grid-cols-[repeat(14,minmax(0,1fr))]">
      <Tag
        id={id}
        className={cn(
          'w-full px-4 tablet-up:px-8 desktop:col-span-12 desktop:col-start-2 desktop:px-0',
          className,
        )}>
        {children}
      </Tag>
    </div>
  );
}

export function Container({
  className,
  children,
  as: Tag = 'div',
  id,
}: ContainerProps) {
  return (
    <Tag
      id={id}
      className={cn(
        'mx-auto w-full max-w-page-content px-4 tablet-up:px-8 desktop:px-0',
        className,
      )}>
      {children}
    </Tag>
  );
}
