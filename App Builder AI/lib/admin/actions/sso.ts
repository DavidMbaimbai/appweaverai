'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth/require-admin';
import { recordAuditLog } from '@/lib/admin/audit';

type ActionResult = { success: true } | { error: string };

export type AdminSsoProviderSummary = {
  id: string;
  providerId: string;
  domain: string;
  issuer: string;
  protocol: 'oidc' | 'saml';
  createdAt: Date;
};

async function getRequestIp() {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/**
 * Enterprise SSO/SAML connections are provisioned by our own team after a
 * sales/onboarding call (never self-service by customers) — see the guard
 * in lib/auth.ts that blocks the underlying @better-auth/sso management
 * endpoints for anyone without `sso:write`.
 */
export async function listSsoProvidersAction(): Promise<
  { providers: AdminSsoProviderSummary[] } | { error: string }
> {
  const admin = await requireAdmin('sso:read');
  if (!admin.ok) return { error: 'Not authorized.' };

  const rows = await prisma.ssoProvider.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      providerId: true,
      domain: true,
      issuer: true,
      oidcConfig: true,
      samlConfig: true,
      createdAt: true,
    },
  });

  return {
    providers: rows.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      domain: row.domain,
      issuer: row.issuer,
      protocol: row.samlConfig ? 'saml' : 'oidc',
      createdAt: row.createdAt,
    })),
  };
}

export async function registerOidcSsoProviderAction(input: {
  providerId: string;
  domain: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin('sso:write');
  if (!admin.ok) return { error: 'Not authorized.' };

  const providerId = input.providerId.trim().toLowerCase();
  const domain = input.domain.trim().toLowerCase();
  const issuer = input.issuer.trim();

  if (!providerId || !domain || !issuer || !input.clientId || !input.clientSecret) {
    return { error: 'All fields are required.' };
  }

  try {
    await auth.api.registerSSOProvider({
      body: {
        providerId,
        issuer,
        domain,
        oidcConfig: {
          clientId: input.clientId.trim(),
          clientSecret: input.clientSecret.trim(),
        },
      },
      headers: await headers(),
    });

    await recordAuditLog({
      adminId: admin.admin.id,
      adminEmail: admin.admin.email,
      action: 'sso.provider_registered',
      targetType: 'SsoProvider',
      targetId: providerId,
      before: null,
      after: { providerId, domain, issuer, protocol: 'oidc' },
      ipAddress: await getRequestIp(),
    });

    revalidatePath('/admin/security/sso');
    return { success: true };
  } catch (error) {
    console.error('Failed to register SSO provider:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to register SSO provider.';
    return { error: message };
  }
}

export async function removeSsoProviderAction(
  providerId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin('sso:write');
  if (!admin.ok) return { error: 'Not authorized.' };

  try {
    await auth.api.deleteSSOProvider({
      body: { providerId },
      headers: await headers(),
    });

    await recordAuditLog({
      adminId: admin.admin.id,
      adminEmail: admin.admin.email,
      action: 'sso.provider_removed',
      targetType: 'SsoProvider',
      targetId: providerId,
      before: { providerId },
      after: null,
      ipAddress: await getRequestIp(),
    });

    revalidatePath('/admin/security/sso');
    return { success: true };
  } catch (error) {
    console.error('Failed to remove SSO provider:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to remove SSO provider.';
    return { error: message };
  }
}
