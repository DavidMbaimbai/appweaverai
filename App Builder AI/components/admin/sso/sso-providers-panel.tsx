'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  registerOidcSsoProviderAction,
  removeSsoProviderAction,
  type AdminSsoProviderSummary,
} from '@/lib/admin/actions/sso';

const EMPTY_FORM = {
  providerId: '',
  domain: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
};

export function SsoProvidersPanel({
  initialProviders,
  readOnly,
}: {
  initialProviders: AdminSsoProviderSummary[];
  readOnly: boolean;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const toast = useToast();

  function updateField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleRegister() {
    startTransition(async () => {
      const result = await registerOidcSsoProviderAction(form);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }

      toast.success(`SSO connection "${form.providerId}" registered.`);
      setProviders((current) => [
        {
          id: form.providerId,
          providerId: form.providerId,
          domain: form.domain.trim().toLowerCase(),
          issuer: form.issuer.trim(),
          protocol: 'oidc',
          createdAt: new Date(),
        },
        ...current,
      ]);
      setForm(EMPTY_FORM);
    });
  }

  function handleRemove(providerId: string) {
    setRemovingId(providerId);
    startTransition(async () => {
      const result = await removeSsoProviderAction(providerId);
      if ('error' in result) {
        toast.error(result.error);
      } else {
        toast.success(`Removed "${providerId}".`);
        setProviders((current) =>
          current.filter((p) => p.providerId !== providerId),
        );
      }
      setRemovingId(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-left text-xs text-app-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Provider ID</th>
              <th className="px-4 py-2.5 font-medium">Domain</th>
              <th className="px-4 py-2.5 font-medium">Issuer</th>
              <th className="px-4 py-2.5 font-medium">Protocol</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr
                key={provider.id}
                className="border-t border-app-border-subtle">
                <td className="px-4 py-2.5 font-mono text-xs text-app-text">
                  {provider.providerId}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {provider.domain}
                </td>
                <td className="max-w-xs truncate px-4 py-2.5 text-app-text-secondary">
                  {provider.issuer}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary uppercase">
                  {provider.protocol}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!readOnly ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      theme="app"
                      disabled={isPending && removingId === provider.providerId}
                      onClick={() => handleRemove(provider.providerId)}>
                      {isPending && removingId === provider.providerId
                        ? 'Removing...'
                        : 'Remove'}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {providers.length === 0 ? (
          <p className="p-8 text-center text-sm text-app-text-muted">
            No Enterprise SSO connections configured yet.
          </p>
        ) : null}
      </div>

      {!readOnly ? (
        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="text-sm font-medium text-app-text">
            Connect a customer&apos;s identity provider (OIDC)
          </h2>
          <p className="mt-1 text-xs text-app-text-muted">
            Only run this after the Enterprise onboarding call, once you have
            the customer&apos;s OIDC client ID/secret and issuer URL (Okta,
            Azure AD, Google Workspace, etc). SAML connections require the
            richer config only available via the API — contact engineering
            for those. The customer&apos;s users will be able to sign in with
            their work email once this is saved.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="Provider ID (unique, e.g. acme-corp-okta)"
              value={form.providerId}
              onChange={(v) => updateField('providerId', v)}
            />
            <Field
              label="Email domain (e.g. acmecorp.com)"
              value={form.domain}
              onChange={(v) => updateField('domain', v)}
            />
            <Field
              label="Issuer URL"
              value={form.issuer}
              onChange={(v) => updateField('issuer', v)}
            />
            <Field
              label="OIDC Client ID"
              value={form.clientId}
              onChange={(v) => updateField('clientId', v)}
            />
            <Field
              label="OIDC Client Secret"
              value={form.clientSecret}
              onChange={(v) => updateField('clientSecret', v)}
              type="password"
            />
          </div>

          <Button
            type="button"
            className="mt-4"
            size="sm"
            theme="app"
            disabled={isPending}
            onClick={handleRegister}>
            {isPending ? 'Connecting...' : 'Register SSO connection'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-app-text-muted">
      {label}
      <Input
        theme="app"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
