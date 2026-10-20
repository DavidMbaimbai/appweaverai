'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';

import {
  deleteStoreCredentialAction,
  generateCapacitorBundleAction,
  generatePwaBundleAction,
  requestNativeBuildAction,
  saveStoreCredentialAction,
  saveStoreListingAction,
  setChecklistItemAction,
} from '@/lib/mobile/actions';
import { STORE_LABELS, STORE_LIMITS, type MobileStoreId } from '@/lib/mobile/listing';
import { INSTALLABILITY_CHECKLIST } from '@/lib/mobile/pwa';
import type { MobileDashboard } from '@/lib/mobile/service';

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  canBuild: boolean;
  canManageCredentials: boolean;
  data: MobileDashboard;
};

const STATUS_STYLE: Record<string, string> = {
  SUCCEEDED: 'bg-green-600/20 text-green-300',
  FAILED: 'bg-red-600/20 text-red-300',
  BLOCKED: 'bg-yellow-600/20 text-yellow-300',
  QUEUED: 'bg-sky-600/20 text-sky-300',
  RUNNING: 'bg-sky-600/20 text-sky-300',
};
const STATUS_LABEL: Record<string, string> = { BLOCKED: 'Blocked: external setup' };
const CHECK_STYLE = { pass: 'text-green-300', warn: 'text-yellow-300', fail: 'text-red-300' } as const;
const STORES: MobileStoreId[] = ['GOOGLE_PLAY', 'APP_STORE_CONNECT'];
const INPUT = 'w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-app-border bg-app-surface/40 p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-app-text-secondary">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function MobileDeliveryView({ projectId, projectName, builderHref, canBuild, canManageCredentials, data }: Props) {
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const [appId, setAppId] = useState(data.suggestedAppId);
  const [appName, setAppName] = useState(projectName.slice(0, 30));
  const [version, setVersion] = useState('1.0.0');
  const [store, setStore] = useState<MobileStoreId>('GOOGLE_PLAY');

  const listing = data.listings.find((l) => l.store === store);
  const [form, setForm] = useState<Record<MobileStoreId, Record<string, string>>>({
    GOOGLE_PLAY: {},
    APP_STORE_CONNECT: {},
  });
  const value = (field: string) =>
    form[store][field] ?? (field === 'screenshotRefs' ? (listing?.screenshotRefs.join('\n') ?? '') : ((listing as Record<string, unknown> | undefined)?.[field] as string | undefined) ?? (field === 'appName' ? appName : field === 'bundleId' ? appId : ''));
  const setValue = (field: string, v: string) => setForm((f) => ({ ...f, [store]: { ...f[store], [field]: v } }));
  const [cred, setCred] = useState({ serviceAccountJson: '', keyId: '', issuerId: '', privateKey: '' });

  function run(task: () => Promise<{ error?: string } & Record<string, unknown>>, ok: (res: Record<string, unknown>) => string) {
    start(async () => {
      setMessage('');
      const res = await task();
      setMessage(res.error ? res.error : ok(res));
    });
  }

  const capOptions = { appId, appName, versionName: version };
  const readiness = data.readiness;
  const storeCredential = data.credentials.find((c) => c.store === store);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <Link href={builderHref} className="text-sm text-app-text-secondary hover:underline">
          ← Back to {projectName}
        </Link>
        <h1 className="mt-3 text-xl font-semibold">Mobile delivery</h1>
        <p className="text-sm text-app-text-secondary">
          Two real outputs: an installable web app (PWA) and an exportable Capacitor project you build into Android and iOS apps.
          Native store binaries need an external build runner, accounts and credentials; until those exist the build is shown as blocked, never as done.
        </p>
      </div>

      {message ? (
        <p role="status" className="rounded-lg border border-app-border bg-app-surface p-3 text-sm">
          {message}
        </p>
      ) : null}

      <Card title="PWA readiness">
        {readiness ? (
          <>
            <p className="mb-2 text-sm">
              Score <strong>{readiness.score}/100</strong> {readiness.installable ? '· installable' : '· not installable yet'} (scored as a PWA build would leave your project).
            </p>
            <ul className="space-y-1 text-sm">
              {readiness.checks.map((c) => (
                <li key={c.id}>
                  <span className={CHECK_STYLE[c.status]}>{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'}</span> {c.label}
                  <span className="text-app-text-muted"> · {c.detail}</span>
                </li>
              ))}
            </ul>
            <details className="mt-3 text-xs text-app-text-secondary">
              <summary className="cursor-pointer">Installability checklist</summary>
              <ul className="mt-1 list-disc pl-5">
                {INSTALLABILITY_CHECKLIST.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="text-sm text-app-text-secondary">{data.readinessError ?? 'No output to check yet.'}</p>
        )}
        {canBuild ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => generatePwaBundleAction(projectId, { name: appName }),
                (r) => `PWA bundle generated (readiness ${String(r.score)}/100). Download it from the history below.`,
              )
            }
            className="mt-3 rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Generate PWA bundle'}
          </button>
        ) : null}
      </Card>

      <Card title="Android and iOS app (Capacitor)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="App id (reverse-DNS)">
            <input className={INPUT} value={appId} onChange={(e) => setAppId(e.target.value)} />
          </Field>
          <Field label="App name">
            <input className={INPUT} value={appName} maxLength={30} onChange={(e) => setAppName(e.target.value)} />
          </Field>
          <Field label="Version">
            <input className={INPUT} value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-app-text-secondary">
          {data.runnerConfigured
            ? `A build runner is configured for: ${data.runnerPlatforms.join(', ')}.`
            : 'No native build runner is configured: native builds will be recorded as "Blocked: external setup". The exported project works on your own machine or CI.'}{' '}
          Native builds are limited to paid plans (placeholder; final pricing not decided).
        </p>
        {canBuild ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {(['ANDROID', 'IOS'] as const).map((platform) => (
              <span key={platform} className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => generateCapacitorBundleAction(projectId, platform, capOptions), () => `${platform} Capacitor project generated.`)
                  }
                  className="rounded-full border border-app-border px-4 py-2 text-sm disabled:opacity-50"
                >
                  Export {platform === 'ANDROID' ? 'Android' : 'iOS'} project
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => requestNativeBuildAction(projectId, platform, capOptions),
                      (r) => (r.status === 'BLOCKED' || r.status === 'FAILED' ? String(r.reason) : 'Native build queued at the runner.'),
                    )
                  }
                  className="rounded-full border border-app-border px-4 py-2 text-sm disabled:opacity-50"
                >
                  Request {platform === 'ANDROID' ? 'Android' : 'iOS'} native build
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-app-text-muted">Your role is read-only here.</p>
        )}
      </Card>

      <Card title="Build history">
        {data.builds.length === 0 ? (
          <p className="text-sm text-app-text-secondary">No builds yet.</p>
        ) : (
          <ul className="divide-y divide-app-border">
            {data.builds.map((b) => (
              <li key={b.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[b.status] ?? ''}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                  <span>
                    {b.platform} · {b.artifactKind.replace('_', ' ').toLowerCase()} · v{b.versionName} (#{b.buildNumber})
                  </span>
                  {b.readinessScore !== null ? <span className="text-app-text-muted">readiness {b.readinessScore}</span> : null}
                  {b.downloadable ? (
                    <a className="text-app-accent underline" href={`/api/projects/${projectId}/mobile/builds/${b.id}/download`}>
                      Download
                    </a>
                  ) : null}
                </div>
                {b.statusReason ? <p className="mt-1 text-xs text-app-text-secondary">{b.statusReason}</p> : null}
                {b.logs && !b.statusReason ? <pre className="mt-1 whitespace-pre-wrap text-xs text-app-text-muted">{b.logs}</pre> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex gap-2">
        {STORES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStore(s)}
            className={`rounded-full px-4 py-1.5 text-sm ${store === s ? 'bg-app-accent text-white' : 'border border-app-border'}`}
          >
            {STORE_LABELS[s]}
          </button>
        ))}
      </div>

      <Card title={`${STORE_LABELS[store]} listing`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`App name (max ${STORE_LIMITS[store].name})`}>
            <input className={INPUT} value={value('appName')} onChange={(e) => setValue('appName', e.target.value)} />
          </Field>
          <Field label="Bundle / application id">
            <input className={INPUT} value={value('bundleId')} onChange={(e) => setValue('bundleId', e.target.value)} />
          </Field>
          <Field label={`${store === 'GOOGLE_PLAY' ? 'Short description' : 'Subtitle'} (max ${STORE_LIMITS[store].shortDescription})`}>
            <input className={INPUT} value={value('shortDescription')} onChange={(e) => setValue('shortDescription', e.target.value)} />
          </Field>
          <Field label="Category">
            <input className={INPUT} value={value('category')} onChange={(e) => setValue('category', e.target.value)} />
          </Field>
          <Field label="Privacy policy URL (https)">
            <input className={INPUT} value={value('privacyUrl')} onChange={(e) => setValue('privacyUrl', e.target.value)} />
          </Field>
          <Field label="Support URL (https)">
            <input className={INPUT} value={value('supportUrl')} onChange={(e) => setValue('supportUrl', e.target.value)} />
          </Field>
          <Field label={`Age rating (${STORE_LIMITS[store].ageRatings.join(' / ')})`}>
            <input className={INPUT} value={value('ageRating')} onChange={(e) => setValue('ageRating', e.target.value)} />
          </Field>
          {store === 'APP_STORE_CONNECT' ? (
            <Field label="Keywords (comma separated, max 100)">
              <input className={INPUT} value={value('keywords')} onChange={(e) => setValue('keywords', e.target.value)} />
            </Field>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Description">
            <textarea className={INPUT} rows={5} value={value('description')} onChange={(e) => setValue('description', e.target.value)} />
          </Field>
          <Field label={`Screenshot references, one per line (https URL or project path; min ${STORE_LIMITS[store].minScreenshots})`}>
            <textarea className={INPUT} rows={5} value={value('screenshotRefs')} onChange={(e) => setValue('screenshotRefs', e.target.value)} />
          </Field>
        </div>
        {listing && listing.issues.length > 0 ? (
          <ul className="mt-3 list-disc pl-5 text-xs text-yellow-300">
            {listing.issues.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        ) : null}
        {canBuild ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveStoreListingAction(projectId, store, {
                    appName: value('appName'),
                    bundleId: value('bundleId'),
                    shortDescription: value('shortDescription'),
                    description: value('description'),
                    category: value('category'),
                    keywords: value('keywords'),
                    privacyUrl: value('privacyUrl'),
                    supportUrl: value('supportUrl'),
                    ageRating: value('ageRating'),
                    screenshotRefs: value('screenshotRefs').split('\n').map((l) => l.trim()).filter(Boolean),
                  }),
                (r) => {
                  const issues = (r.issues as unknown[]).length;
                  return issues === 0 ? 'Listing saved and valid.' : `Listing saved with ${issues} issue(s) to fix.`;
                },
              )
            }
            className="mt-3 rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save listing
          </button>
        ) : null}
      </Card>

      <Card title={`${STORE_LABELS[store]} submission checklist`}>
        <ul className="space-y-2 text-sm">
          {data.checklists[store].map((item) => (
            <li key={item.key} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={item.done}
                disabled={item.kind === 'auto' || !canBuild || pending}
                onChange={(e) => run(() => setChecklistItemAction(projectId, store, item.key, e.target.checked), () => 'Checklist updated.')}
              />
              <span>
                {item.label} <span className="text-xs text-app-text-muted">({item.kind === 'auto' ? 'automatic' : 'you confirm'})</span>
                <span className="block text-xs text-app-text-secondary">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`${STORE_LABELS[store]} credentials`}>
        <p className="mb-2 text-xs text-app-text-secondary">
          Stored encrypted and never shown again. Saving them does not publish anything; they are only used by a configured build runner.
        </p>
        {storeCredential ? <p className="mb-2 text-sm">Saved: {storeCredential.hint}</p> : null}
        {canManageCredentials ? (
          <>
            {store === 'GOOGLE_PLAY' ? (
              <Field label="Service account key (JSON)">
                <textarea className={INPUT} rows={4} value={cred.serviceAccountJson} onChange={(e) => setCred({ ...cred, serviceAccountJson: e.target.value })} />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Key ID">
                  <input className={INPUT} value={cred.keyId} onChange={(e) => setCred({ ...cred, keyId: e.target.value })} />
                </Field>
                <Field label="Issuer ID">
                  <input className={INPUT} value={cred.issuerId} onChange={(e) => setCred({ ...cred, issuerId: e.target.value })} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Private key (.p8 contents)">
                    <textarea className={INPUT} rows={4} value={cred.privateKey} onChange={(e) => setCred({ ...cred, privateKey: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    async () => {
                      const res =
                        store === 'GOOGLE_PLAY'
                          ? await saveStoreCredentialAction(projectId, { store, serviceAccountJson: cred.serviceAccountJson })
                          : await saveStoreCredentialAction(projectId, { store, keyId: cred.keyId, issuerId: cred.issuerId, privateKey: cred.privateKey });
                      if (!('error' in res)) setCred({ serviceAccountJson: '', keyId: '', issuerId: '', privateKey: '' });
                      return res;
                    },
                    () => 'Credentials saved (encrypted).',
                  )
                }
                className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Save credentials
              </button>
              {storeCredential ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteStoreCredentialAction(projectId, store), () => 'Credentials removed.')}
                  className="rounded-full border border-app-border px-4 py-2 text-sm disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-xs text-app-text-muted">Only developers, admins and owners can manage store credentials.</p>
        )}
      </Card>
    </div>
  );
}
