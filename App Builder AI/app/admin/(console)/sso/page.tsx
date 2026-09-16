import { AdminPageHeader } from '@/components/admin/ui/primitives';
import { requireAdmin } from '@/lib/auth/require-admin';
import { hasPermission } from '@/lib/admin/permissions';
import { listSsoProvidersAction } from '@/lib/admin/actions/sso';
import { SsoProvidersPanel } from '@/components/admin/sso/sso-providers-panel';

export default async function AdminSsoPage() {
  const admin = await requireAdmin('sso:read');
  if (!admin.ok) {
    return null;
  }

  const result = await listSsoProvidersAction();
  const providers = 'providers' in result ? result.providers : [];
  const readOnly = !hasPermission(admin.admin.adminRole, 'sso:write');

  return (
    <div>
      <AdminPageHeader
        title="Enterprise SSO"
        description="Manage OIDC/SAML connections for Enterprise customers. Onboarding is handled by our team after the sales/contact-sales process — this is never self-service for customers."
      />

      <SsoProvidersPanel initialProviders={providers} readOnly={readOnly} />
    </div>
  );
}
