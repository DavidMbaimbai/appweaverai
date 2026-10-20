import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { zipSync } from 'fflate';

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { buildBundledPreviewHtml, bundleArtifact } from '@/lib/preview/bundle-artifact';
import { resolveProjectStack } from '@/lib/preview/detect-preview-mode';
import { artifactWorkspaceDir } from '@/lib/preview/list-workspace-paths';
import { stripPreviewBaseHref } from '@/lib/project-files';

import { buildCapacitorProjectFiles, suggestAppId, validateAppId } from './capacitor';
import { parseStoreCredential, type StoreCredentialInput } from './credentials';
import {
  evaluateChecklist,
  isManualChecklistKey,
  validateListing,
  type ChecklistResult,
  type ListingInput,
  type MobileStoreId,
} from './listing';
import {
  canTransition,
  decideNativeBuild,
  getRunnerConfig,
  submitToRunner,
  type BuildStatus,
  type NativePlatform,
  type RunnerCallback,
} from './provider';
import { applyPwa, toBytes, type OutputFiles, type PwaOptions } from './pwa';
import { evaluatePwaReadiness, type PwaReadiness } from './readiness';

export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const SOURCE_EXT = /\.(jsx|tsx|ts|map)$/i;

export type BuiltOutput = { artifactSlug: string; files: OutputFiles; publicUrl: string | null };

/** The project's deployable web output: static files as-is, or the bundled frontend for React/ESM stacks. Server code is excluded. */
export async function loadBuiltOutput(projectId: string): Promise<BuiltOutput | { error: string }> {
  const artifact = await prisma.artifact.findFirst({
    where: { projectId, codingLanguage: null, type: { in: ['WEB_APP', 'MOBILE_APP'] } },
    orderBy: { sortOrder: 'asc' },
    select: { slug: true, publishedUrl: true },
  });
  if (!artifact) return { error: 'This project has no web app to package yet.' };

  const { stack, relativePaths } = await resolveProjectStack(projectId, artifact.slug);
  if (relativePaths.length === 0) return { error: 'Nothing to package yet. Ask the agent to build the app first.' };

  const root = artifactWorkspaceDir(projectId, artifact.slug);
  const files: OutputFiles = {};
  let total = 0;
  for (const relative of relativePaths) {
    if (relative.startsWith('backend/') || relative.startsWith('node_modules/')) continue;
    if (stack !== 'static' && (SOURCE_EXT.test(relative) || /\.(js|mjs)$/i.test(relative))) continue;
    const bytes = await readFile(path.join(root, relative));
    total += bytes.length;
    if (total > MAX_ARTIFACT_BYTES) return { error: 'The project output is too large to package (25 MB limit).' };
    files[relative] = bytes;
  }

  if (stack !== 'static') {
    try {
      const bundleJs = await bundleArtifact({ projectId, artifactSlug: artifact.slug, relativePaths, stack });
      const html = await buildBundledPreviewHtml({ projectId, artifactSlug: artifact.slug, bundleUrl: 'app.bundle.js', stack });
      files['index.html'] = toBytes(stripPreviewBaseHref(html));
      files['app.bundle.js'] = toBytes(bundleJs);
    } catch {
      return { error: 'The frontend failed to bundle. Ask the agent to fix it first.' };
    }
  }
  return { artifactSlug: artifact.slug, files, publicUrl: artifact.publishedUrl };
}

export function zipFiles(files: OutputFiles) {
  return zipSync(files, { level: 6 });
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type AnyPlatform = 'ANDROID' | 'IOS' | 'PWA';

async function nextBuildNumber(projectId: string, platform: AnyPlatform) {
  const last = await prisma.mobileBuild.aggregate({ where: { projectId, platform }, _max: { buildNumber: true } });
  return (last._max.buildNumber ?? 0) + 1;
}

/** Retries on the unique (project, platform, build number) race. */
async function createBuildRow(
  projectId: string,
  platform: AnyPlatform,
  make: (buildNumber: number) => Prisma.MobileBuildUncheckedCreateInput,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.mobileBuild.create({ data: make(await nextBuildNumber(projectId, platform)) });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002' || attempt === 2) throw error;
    }
  }
  throw new Error('Could not allocate a build number.');
}

async function failBuild(id: string, message: string) {
  await prisma.mobileBuild.update({
    where: { id },
    data: { status: 'FAILED', statusReason: message, logs: message, finishedAt: new Date() },
  });
}

export type PwaBuildInput = Omit<PwaOptions, 'name'> & { name?: string };

export async function createPwaBuild(input: { projectId: string; userId: string; options: PwaBuildInput }) {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { name: true } });
  const output = await loadBuiltOutput(input.projectId);
  if ('error' in output) return output;

  const name = input.options.name?.trim() || project?.name || 'App';
  const row = await createBuildRow(input.projectId, 'PWA', (buildNumber) => ({
    projectId: input.projectId,
    artifactSlug: output.artifactSlug,
    platform: 'PWA',
    status: 'RUNNING',
    artifactKind: 'PWA_BUNDLE',
    versionName: `1.0.${buildNumber}`,
    buildNumber,
    createdById: input.userId,
  }));

  try {
    const { files, added, kept } = applyPwa(output.files, { ...input.options, name }, `v${row.buildNumber}`);
    const readiness = evaluatePwaReadiness({ files, publicUrl: output.publicUrl });
    const zip = zipFiles(files);
    if (zip.length > MAX_ARTIFACT_BYTES) throw new Error('Bundle exceeds the 25 MB limit.');
    const logs = [
      `Added: ${added.join(', ') || 'nothing'}`,
      `Kept existing: ${kept.join(', ') || 'nothing'}`,
      `Readiness score: ${readiness.score}/100 (${readiness.installable ? 'installable' : 'NOT installable yet'})`,
      ...readiness.checks.filter((c) => c.status !== 'pass').map((c) => `${c.status.toUpperCase()}: ${c.label} - ${c.detail}`),
    ].join('\n');
    await prisma.mobileBuild.update({
      where: { id: row.id },
      data: {
        status: 'SUCCEEDED',
        artifactName: `pwa-${row.buildNumber}.zip`,
        artifactSize: zip.length,
        artifactSha256: sha256(zip),
        artifactData: Buffer.from(zip),
        readinessScore: readiness.score,
        logs,
        finishedAt: new Date(),
      },
    });
    return { buildId: row.id, readiness };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Build failed.';
    await failBuild(row.id, message);
    return { error: message };
  }
}

export type CapacitorOptionsInput = { appId: string; appName: string; versionName: string; serverUrl?: string | null };

export async function createCapacitorBundle(input: {
  projectId: string;
  userId: string;
  platform: NativePlatform;
  options: CapacitorOptionsInput;
}) {
  const idError = validateAppId(input.options.appId);
  if (idError) return { error: idError };
  const output = await loadBuiltOutput(input.projectId);
  if ('error' in output) return output;

  const row = await createBuildRow(input.projectId, input.platform, (buildNumber) => ({
    projectId: input.projectId,
    artifactSlug: output.artifactSlug,
    platform: input.platform,
    status: 'RUNNING',
    artifactKind: 'CAPACITOR_PROJECT',
    versionName: input.options.versionName,
    buildNumber,
    createdById: input.userId,
  }));

  try {
    const pwa = applyPwa(output.files, { name: input.options.appName }, `v${row.buildNumber}`);
    const readiness = evaluatePwaReadiness({ files: pwa.files, publicUrl: output.publicUrl });
    const project = buildCapacitorProjectFiles(pwa.files, { ...input.options, buildNumber: row.buildNumber });
    const zip = zipFiles(project);
    if (zip.length > MAX_ARTIFACT_BYTES) throw new Error('Bundle exceeds the 25 MB limit.');
    await prisma.mobileBuild.update({
      where: { id: row.id },
      data: {
        status: 'SUCCEEDED',
        artifactName: `capacitor-${input.platform.toLowerCase()}-${row.buildNumber}.zip`,
        artifactSize: zip.length,
        artifactSha256: sha256(zip),
        artifactData: Buffer.from(zip),
        readinessScore: readiness.score,
        logs: `Generated an exportable Capacitor project (${Object.keys(project).length} files). This is source for a native build, not a compiled app.`,
        finishedAt: new Date(),
      },
    });
    return { buildId: row.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bundle failed.';
    await failBuild(row.id, message);
    return { error: message };
  }
}

/** Records a native build. It is BLOCKED (never faked) unless a configured runner accepts the job. */
export async function requestNativeBuild(input: {
  projectId: string;
  userId: string;
  platform: NativePlatform;
  planAllowsNative: boolean;
  options: CapacitorOptionsInput;
  callbackUrl: string;
}) {
  const store: MobileStoreId = input.platform === 'ANDROID' ? 'GOOGLE_PLAY' : 'APP_STORE_CONNECT';
  const credential = await prisma.mobileStoreCredential.findUnique({
    where: { projectId_store: { projectId: input.projectId, store } },
    select: { id: true },
  });
  const runner = getRunnerConfig();
  const decision = decideNativeBuild({
    platform: input.platform,
    runner,
    hasStoreCredential: Boolean(credential),
    planAllowsNative: input.planAllowsNative,
  });

  const bundle = await createCapacitorBundle(input);
  if ('error' in bundle) return bundle;

  const blocked = decision.action === 'blocked' ? decision.reason : null;
  const native = await createBuildRow(input.projectId, input.platform, (buildNumber) => ({
    projectId: input.projectId,
    artifactSlug: '',
    platform: input.platform,
    status: blocked ? 'BLOCKED' : 'QUEUED',
    artifactKind: 'NATIVE_BINARY',
    versionName: input.options.versionName,
    buildNumber,
    statusReason: blocked,
    logs: blocked ?? 'Submitting to the build runner.',
    createdById: input.userId,
    finishedAt: blocked ? new Date() : null,
  }));
  if (blocked || !runner) return { buildId: native.id, status: 'BLOCKED' as const, reason: blocked };

  const source = await prisma.mobileBuild.findUnique({ where: { id: bundle.buildId }, select: { artifactData: true } });
  const submission = await submitToRunner(runner, {
    buildId: native.id,
    platform: input.platform,
    appId: input.options.appId,
    versionName: input.options.versionName,
    buildNumber: native.buildNumber,
    bundleBase64: Buffer.from(source?.artifactData ?? new Uint8Array()).toString('base64'),
    callbackUrl: input.callbackUrl,
  });
  if (!submission.ok) {
    await failBuild(native.id, submission.error);
    return { buildId: native.id, status: 'FAILED' as const, reason: submission.error };
  }
  await prisma.mobileBuild.update({
    where: { id: native.id },
    data: { externalJobId: submission.jobId, logs: `Queued at the runner as job ${submission.jobId}.` },
  });
  return { buildId: native.id, status: 'QUEUED' as const, reason: null };
}

/** Applies a runner status callback. Terminal builds are immutable and only runner-accepted native builds can change. */
export async function applyRunnerCallback(callback: RunnerCallback) {
  const build = await prisma.mobileBuild.findUnique({
    where: { id: callback.buildId },
    select: { id: true, status: true, artifactKind: true, externalJobId: true },
  });
  if (!build || build.artifactKind !== 'NATIVE_BINARY' || !build.externalJobId) return { error: 'Unknown build.' } as const;
  if (!canTransition(build.status as BuildStatus, callback.status)) return { error: 'Build is already finished.' } as const;
  await prisma.mobileBuild.update({
    where: { id: build.id },
    data: {
      status: callback.status,
      logs: callback.logs ?? undefined,
      statusReason: callback.status === 'FAILED' ? (callback.error ?? 'The runner reported a failure.') : null,
      artifactName: callback.artifactName,
      artifactSha256: callback.artifactSha256?.toLowerCase(),
      finishedAt: callback.status === 'RUNNING' ? null : new Date(),
    },
  });
  return { ok: true } as const;
}

export type MobileBuildRow = {
  id: string;
  platform: string;
  status: string;
  artifactKind: string;
  versionName: string;
  buildNumber: number;
  statusReason: string | null;
  logs: string;
  readinessScore: number | null;
  artifactName: string | null;
  artifactSize: number | null;
  artifactSha256: string | null;
  downloadable: boolean;
  createdAt: string;
};

export type ListingRow = ListingInput & { store: MobileStoreId; issues: { field: string; message: string }[] };

export type MobileDashboard = {
  readiness: PwaReadiness | null;
  readinessError: string | null;
  runnerConfigured: boolean;
  runnerPlatforms: string[];
  builds: MobileBuildRow[];
  credentials: { store: MobileStoreId; hint: string; updatedAt: string }[];
  listings: ListingRow[];
  checklists: Record<MobileStoreId, ChecklistResult>;
  suggestedAppId: string;
  projectName: string;
};

export const STORES: MobileStoreId[] = ['GOOGLE_PLAY', 'APP_STORE_CONNECT'];

function toListingInput(row: ListingInput): ListingInput {
  return {
    appName: row.appName,
    bundleId: row.bundleId,
    shortDescription: row.shortDescription,
    description: row.description,
    category: row.category,
    keywords: row.keywords,
    privacyUrl: row.privacyUrl,
    supportUrl: row.supportUrl,
    ageRating: row.ageRating,
    screenshotRefs: row.screenshotRefs,
  };
}

/** Everything is scoped by projectId; callers must authorise the project first. Credential payloads are never selected. */
export async function loadMobileDashboard(projectId: string, projectName: string, projectSlug: string): Promise<MobileDashboard> {
  const [builds, credentials, listings, checks, output] = await Promise.all([
    prisma.mobileBuild.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        platform: true,
        status: true,
        artifactKind: true,
        versionName: true,
        buildNumber: true,
        statusReason: true,
        logs: true,
        readinessScore: true,
        artifactName: true,
        artifactSize: true,
        artifactSha256: true,
        createdAt: true,
      },
    }),
    prisma.mobileStoreCredential.findMany({ where: { projectId }, select: { store: true, hint: true, updatedAt: true } }),
    prisma.mobileStoreListing.findMany({ where: { projectId } }),
    prisma.mobileChecklistItem.findMany({ where: { projectId, done: true }, select: { store: true, itemKey: true } }),
    loadBuiltOutput(projectId),
  ]);

  let readiness: PwaReadiness | null = null;
  let readinessError: string | null = null;
  if ('error' in output) readinessError = output.error;
  else {
    // Scored as a PWA build would leave it, so the owner sees what remains after generation.
    const preview = applyPwa(output.files, { name: projectName });
    readiness = evaluatePwaReadiness({ files: preview.files, publicUrl: output.publicUrl });
  }

  const runner = getRunnerConfig();
  const checklists = {} as Record<MobileStoreId, ChecklistResult>;
  const listingRows: ListingRow[] = [];
  for (const store of STORES) {
    const listing = listings.find((l) => l.store === store);
    const input = listing ? toListingInput(listing) : null;
    const issues = input ? validateListing(store, input) : [];
    if (input) listingRows.push({ ...input, store, issues });
    const manual = new Set(checks.filter((c) => c.store === store).map((c) => c.itemKey));
    checklists[store] = evaluateChecklist(
      store,
      {
        listingValid: Boolean(input) && issues.length === 0,
        privacyUrlValid: Boolean(input) && input!.privacyUrl.length > 0 && !issues.some((i) => i.field === 'privacyUrl'),
        credentialsSaved: credentials.some((c) => c.store === store),
        bundleBuilt: builds.some(
          (b) => b.artifactKind === 'CAPACITOR_PROJECT' && b.status === 'SUCCEEDED' && b.platform === (store === 'GOOGLE_PLAY' ? 'ANDROID' : 'IOS'),
        ),
      },
      manual,
    );
  }

  return {
    readiness,
    readinessError,
    runnerConfigured: Boolean(runner),
    runnerPlatforms: runner ? [...runner.platforms] : [],
    builds: builds.map((b) => ({
      ...b,
      downloadable: b.artifactKind !== 'NATIVE_BINARY' && b.status === 'SUCCEEDED',
      createdAt: b.createdAt.toISOString(),
    })),
    credentials: credentials.map((c) => ({ store: c.store, hint: c.hint, updatedAt: c.updatedAt.toISOString() })),
    listings: listingRows,
    checklists,
    suggestedAppId: suggestAppId(projectSlug),
    projectName,
  };
}

export async function getBuildArtifact(projectId: string, buildId: string) {
  return prisma.mobileBuild.findFirst({
    where: { id: buildId, projectId, status: 'SUCCEEDED', artifactData: { not: null } },
    select: { artifactData: true, artifactName: true, artifactSha256: true },
  });
}

export async function saveStoreCredential(input: { projectId: string; userId: string; credential: StoreCredentialInput }) {
  const parsed = parseStoreCredential(input.credential);
  if ('error' in parsed) return parsed;
  const encryptedPayload = encryptSecret(parsed.payload);
  await prisma.mobileStoreCredential.upsert({
    where: { projectId_store: { projectId: input.projectId, store: input.credential.store } },
    create: { projectId: input.projectId, store: input.credential.store, encryptedPayload, hint: parsed.hint, createdById: input.userId },
    update: { encryptedPayload, hint: parsed.hint },
  });
  return { hint: parsed.hint };
}

export async function deleteStoreCredential(projectId: string, store: MobileStoreId) {
  const { count } = await prisma.mobileStoreCredential.deleteMany({ where: { projectId, store } });
  return count > 0;
}

/** Server-side only: for handing credentials to a configured runner. Never return this to a client. */
export async function readStoreCredential(projectId: string, store: MobileStoreId) {
  const row = await prisma.mobileStoreCredential.findUnique({
    where: { projectId_store: { projectId, store } },
    select: { encryptedPayload: true },
  });
  return row ? (JSON.parse(decryptSecret(row.encryptedPayload)) as Record<string, string>) : null;
}

export async function saveListing(input: { projectId: string; userId: string; store: MobileStoreId; listing: ListingInput }) {
  const issues = validateListing(input.store, input.listing);
  const data = { ...toListingInput(input.listing), appName: input.listing.appName.trim(), updatedById: input.userId };
  await prisma.mobileStoreListing.upsert({
    where: { projectId_store: { projectId: input.projectId, store: input.store } },
    create: { projectId: input.projectId, store: input.store, ...data },
    update: data,
  });
  return { issues };
}

export async function setChecklistItem(input: { projectId: string; userId: string; store: MobileStoreId; key: string; done: boolean }) {
  if (!isManualChecklistKey(input.store, input.key)) return { error: 'This item is checked automatically.' } as const;
  await prisma.mobileChecklistItem.upsert({
    where: { projectId_store_itemKey: { projectId: input.projectId, store: input.store, itemKey: input.key } },
    create: { projectId: input.projectId, store: input.store, itemKey: input.key, done: input.done, updatedById: input.userId },
    update: { done: input.done, updatedById: input.userId },
  });
  return { ok: true } as const;
}
