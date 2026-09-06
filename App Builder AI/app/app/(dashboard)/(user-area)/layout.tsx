import { UserAreaLayout } from '@/components/app/shell/user-area-layout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <UserAreaLayout>{children}</UserAreaLayout>;
}
