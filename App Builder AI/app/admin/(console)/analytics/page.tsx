import {
  AdminEmptyState,
  AdminPageHeader,
} from '@/components/admin/ui/primitives';
import { requireAdmin } from '@/lib/auth/require-admin';

export default async function Page() {
  const auth = await requireAdmin('analytics:read');
  if (!auth.ok) return null;

  return (
    <div>
      <AdminPageHeader
        title="Analytics"
        description="Deeper product and usage analytics beyond AI Usage and Dashboard. This section is still being built out."
      />
      <AdminEmptyState message="Analytics reporting is coming soon. In the meantime, see Dashboard and AI Usage for current usage and performance data." />
    </div>
  );
}
