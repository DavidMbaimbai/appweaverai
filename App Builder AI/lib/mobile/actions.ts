'use server';

import { revalidatePath } from 'next/cache';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { getCachedSession } from '@/lib/auth/cached';
import { getUserEntitlements } from '@/lib/billing/gate';
import { appOrigin } from '@/lib/observatory/smoke';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { requireProjectCapability } from '@/lib/team/access';
import type { Capability } from '@/lib/team/permissions';

import type { StoreCredentialInput } from './credentials';
import { MOBILE_STORES, type ListingInput, type MobileStoreId } from './listing';
import type { NativePlatform } from './provider';
import {
  createCapacitorBundle,
  createPwaBuild,
  deleteStoreCredential,
  requestNativeBuild,
  saveListing,
  saveStoreCredential,
  setChecklistItem,
  type CapacitorOptionsInput,
} from './service';

type Failure = { error: string };

/** Signed in and holding `capability` on this project; every mutation is also rate limited per user. */
async function authorize(projectId: string, capability: Capability, bucket: string, limit: number): Promise<{ userId: string } | Failure> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' };
  const access = await requireProjectCapability(userId, projectId, capability);
  if (!access.ok) return { error: access.error };
  const limited = await rateLimit(`mobile:${bucket}:${userId}`, limit, 60 * 60_000);
  if (!limited.ok) return { error: 'Too many requests. Try again later.' };
  return { userId };
}

async function refresh(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true, workspace: { select: { slug: true } } },
  });
  if (project) revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}/mobile`);
}

const isStore = (value: unknown): value is MobileStoreId => MOBILE_STORES.includes(value as MobileStoreId);
const isPlatform = (value: unknown): value is NativePlatform => value === 'ANDROID' || value === 'IOS';
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VERSION = /^\d{1,4}(\.\d{1,4}){1,2}$/;

function capacitorOptions(raw: CapacitorOptionsInput): CapacitorOptionsInput | Failure {
  const appName = text(raw.appName, 30).trim();
  if (!appName) return { error: 'App name is required.' };
  const versionName = text(raw.versionName, 20).trim();
  if (!VERSION.test(versionName)) return { error: 'Version must look like 1.0 or 1.0.0.' };
  const serverUrl = raw.serverUrl ? text(raw.serverUrl, 500).trim() : null;
  if (serverUrl && !/^https:\/\//i.test(serverUrl)) return { error: 'Server URL must start with https://.' };
  return { appId: text(raw.appId, 155).trim(), appName, versionName, serverUrl };
}

export async function generatePwaBundleAction(projectId: string, raw: { name?: string; themeColor?: string; backgroundColor?: string }) {
  const auth = await authorize(projectId, 'publish', 'pwa', 20);
  if ('error' in auth) return auth;
  const result = await createPwaBuild({
    projectId,
    userId: auth.userId,
    options: {
      name: text(raw.name, 45).trim() || undefined,
      themeColor: raw.themeColor && COLOR.test(raw.themeColor) ? raw.themeColor : undefined,
      backgroundColor: raw.backgroundColor && COLOR.test(raw.backgroundColor) ? raw.backgroundColor : undefined,
    },
  });
  if ('error' in result) return result;
  await recordUserActivity({
    userId: auth.userId,
    action: 'mobile.pwa_bundle_generated',
    targetType: 'Project',
    targetId: projectId,
    after: { buildId: result.buildId, score: result.readiness.score },
  });
  await refresh(projectId);
  return { success: true as const, buildId: result.buildId, score: result.readiness.score };
}

export async function generateCapacitorBundleAction(projectId: string, platform: NativePlatform, raw: CapacitorOptionsInput) {
  if (!isPlatform(platform)) return { error: 'Choose Android or iOS.' };
  const auth = await authorize(projectId, 'publish', 'capacitor', 20);
  if ('error' in auth) return auth;
  const options = capacitorOptions(raw);
  if ('error' in options) return options;
  const result = await createCapacitorBundle({ projectId, userId: auth.userId, platform, options });
  if ('error' in result) return result;
  await recordUserActivity({
    userId: auth.userId,
    action: 'mobile.capacitor_bundle_generated',
    targetType: 'Project',
    targetId: projectId,
    after: { buildId: result.buildId, platform, appId: options.appId },
  });
  await refresh(projectId);
  return { success: true as const, buildId: result.buildId };
}

export async function requestNativeBuildAction(projectId: string, platform: NativePlatform, raw: CapacitorOptionsInput) {
  if (!isPlatform(platform)) return { error: 'Choose Android or iOS.' };
  const auth = await authorize(projectId, 'publish', 'native', 10);
  if ('error' in auth) return auth;
  const options = capacitorOptions(raw);
  if ('error' in options) return options;

  const ent = await getUserEntitlements(auth.userId);
  const origin = appOrigin();
  // Placeholder gate: native builds are paid-plan only until pricing is decided (see docs/mobile-delivery.md).
  const result = await requestNativeBuild({
    projectId,
    userId: auth.userId,
    platform,
    options,
    planAllowsNative: ent.planId !== 'free',
    callbackUrl: `${origin}/api/mobile/runner-callback`,
  });
  if ('error' in result) return result;
  await recordUserActivity({
    userId: auth.userId,
    action: 'mobile.native_build_requested',
    targetType: 'Project',
    targetId: projectId,
    after: { buildId: result.buildId, platform, status: result.status },
  });
  await refresh(projectId);
  return { success: true as const, buildId: result.buildId, status: result.status, reason: result.reason };
}

export async function saveStoreCredentialAction(projectId: string, credential: StoreCredentialInput) {
  if (!credential || !isStore(credential.store)) return { error: 'Unknown store.' };
  const auth = await authorize(projectId, 'manage_integrations', 'credential', 20);
  if ('error' in auth) return auth;
  const clean: StoreCredentialInput =
    credential.store === 'GOOGLE_PLAY'
      ? { store: 'GOOGLE_PLAY', serviceAccountJson: text(credential.serviceAccountJson, 10_000) }
      : {
          store: 'APP_STORE_CONNECT',
          keyId: text(credential.keyId, 20),
          issuerId: text(credential.issuerId, 50),
          privateKey: text(credential.privateKey, 5_000),
        };
  const result = await saveStoreCredential({ projectId, userId: auth.userId, credential: clean });
  if ('error' in result) return result;
  await recordUserActivity({
    userId: auth.userId,
    action: 'mobile.store_credential_saved',
    targetType: 'Project',
    targetId: projectId,
    after: { store: credential.store, hint: result.hint },
  });
  await refresh(projectId);
  return { success: true as const, hint: result.hint };
}

export async function deleteStoreCredentialAction(projectId: string, store: MobileStoreId) {
  if (!isStore(store)) return { error: 'Unknown store.' };
  const auth = await authorize(projectId, 'manage_integrations', 'credential', 20);
  if ('error' in auth) return auth;
  await deleteStoreCredential(projectId, store);
  await recordUserActivity({
    userId: auth.userId,
    action: 'mobile.store_credential_deleted',
    targetType: 'Project',
    targetId: projectId,
    after: { store },
  });
  await refresh(projectId);
  return { success: true as const };
}

export async function saveStoreListingAction(projectId: string, store: MobileStoreId, raw: ListingInput) {
  if (!isStore(store)) return { error: 'Unknown store.' };
  const auth = await authorize(projectId, 'publish', 'listing', 60);
  if ('error' in auth) return auth;
  const listing: ListingInput = {
    appName: text(raw.appName, 100),
    bundleId: text(raw.bundleId, 155).trim(),
    shortDescription: text(raw.shortDescription, 200),
    description: text(raw.description, 5000),
    category: text(raw.category, 60),
    keywords: text(raw.keywords, 200),
    privacyUrl: text(raw.privacyUrl, 500).trim(),
    supportUrl: text(raw.supportUrl, 500).trim(),
    ageRating: text(raw.ageRating, 30),
    screenshotRefs: Array.isArray(raw.screenshotRefs) ? raw.screenshotRefs.slice(0, 12).map((r) => text(r, 500).trim()).filter(Boolean) : [],
  };
  const result = await saveListing({ projectId, userId: auth.userId, store, listing });
  await recordUserActivity({
    userId: auth.userId,
    action: 'mobile.listing_saved',
    targetType: 'Project',
    targetId: projectId,
    after: { store, issues: result.issues.length },
  });
  await refresh(projectId);
  return { success: true as const, issues: result.issues };
}

export async function setChecklistItemAction(projectId: string, store: MobileStoreId, key: string, done: boolean) {
  if (!isStore(store) || typeof key !== 'string') return { error: 'Unknown checklist item.' };
  const auth = await authorize(projectId, 'publish', 'checklist', 200);
  if ('error' in auth) return auth;
  const result = await setChecklistItem({ projectId, userId: auth.userId, store, key: key.slice(0, 60), done: Boolean(done) });
  if ('error' in result) return result;
  await refresh(projectId);
  return { success: true as const };
}
