import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

import { createSafeFetch, validateOutboundUrl } from './ssrf';

export const REPLAY_TOLERANCE_SECONDS = 300;
export const MAX_INBOUND_BYTES = 256 * 1024;
export const MAX_DELIVERY_ATTEMPTS = 6;
export const MAX_ENDPOINTS_PER_PROJECT = 10;
export const MAX_SUBSCRIPTIONS_PER_PROJECT = 10;
const AUTO_DISABLE_AFTER_FAILURES = 20;
/** Wait before attempt n+1 after attempt n failed (seconds): 1m, 5m, 30m, 2h, 12h. */
const BACKOFF_SECONDS = [60, 300, 1_800, 7_200, 43_200];

export function generateWebhookSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** hex(HMAC-SHA256(secret, `${timestamp}.${body}`)); the timestamp is signed so it cannot be swapped to replay a body. */
export function signWebhook(secret: string, timestamp: number | string, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function signatureHeader(secret: string, timestamp: number, body: string) {
  return `v1=${signWebhook(secret, timestamp, body)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'bad_signature' };

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): VerifyResult {
  if (!input.timestamp || !input.signature) return { ok: false, reason: 'missing' };
  const ts = Number(input.timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: 'missing' };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? REPLAY_TOLERANCE_SECONDS)) return { ok: false, reason: 'stale' };

  const expected = Buffer.from(signWebhook(input.secret, ts, input.body), 'hex');
  const candidates = input.signature.split(',').map((s) => s.trim()).filter((s) => s.startsWith('v1='));
  for (const candidate of candidates) {
    const given = Buffer.from(candidate.slice(3), 'hex');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}

export function backoffSeconds(attemptsMade: number): number | null {
  if (attemptsMade >= MAX_DELIVERY_ATTEMPTS) return null;
  return BACKOFF_SECONDS[Math.min(attemptsMade, BACKOFF_SECONDS.length) - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export type InboundOutcome =
  | { status: 200; duplicate: boolean }
  | { status: 400 | 401 | 404 | 413 | 429; error: string };

export async function receiveInboundWebhook(input: {
  publicId: string;
  body: string;
  headers: { id: string | null; timestamp: string | null; signature: string | null };
  nowSeconds?: number;
}): Promise<InboundOutcome> {
  if (input.body.length > MAX_INBOUND_BYTES) return { status: 413, error: 'Payload too large.' };
  const endpoint = await prisma.inboundWebhookEndpoint.findUnique({ where: { publicId: input.publicId } });
  if (!endpoint || !endpoint.active) return { status: 404, error: 'Not found.' };

  const limited = await rateLimit(`webhook-in:${endpoint.id}`, 120, 60_000);
  if (!limited.ok) return { status: 429, error: 'Too many requests.' };

  let secret: string;
  try {
    secret = decryptSecret(endpoint.secretEnc);
  } catch {
    return { status: 404, error: 'Not found.' };
  }
  const verdict = verifyWebhookSignature({
    secret,
    timestamp: input.headers.timestamp,
    signature: input.headers.signature,
    body: input.body,
    nowSeconds: input.nowSeconds,
  });
  if (!verdict.ok) {
    return { status: 401, error: verdict.reason === 'stale' ? 'Timestamp outside the allowed window.' : 'Invalid signature.' };
  }

  const eventId = input.headers.id?.trim();
  if (!eventId || eventId.length > 128 || !/^[\w.:-]+$/.test(eventId)) {
    return { status: 400, error: 'X-Webhook-Id is required (letters, numbers, . _ : -).' };
  }

  try {
    await prisma.inboundWebhookEvent.create({ data: { endpointId: endpoint.id, eventId, payload: input.body } });
    return { status: 200, duplicate: false };
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return { status: 200, duplicate: true };
    throw error;
  }
}

export async function createInboundEndpoint(projectId: string, name: string) {
  const count = await prisma.inboundWebhookEndpoint.count({ where: { projectId } });
  if (count >= MAX_ENDPOINTS_PER_PROJECT) return { ok: false as const, error: `A project can have up to ${MAX_ENDPOINTS_PER_PROJECT} inbound endpoints.` };
  const secret = generateWebhookSecret();
  const row = await prisma.inboundWebhookEndpoint.create({
    data: { projectId, name: name.trim().slice(0, 80) || 'Webhook', publicId: randomBytes(16).toString('hex'), secretEnc: encryptSecret(secret) },
  });
  return { ok: true as const, endpoint: row, secret };
}

export async function listInboundEndpoints(projectId: string) {
  const rows = await prisma.inboundWebhookEndpoint.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, publicId: true, active: true, createdAt: true, _count: { select: { events: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, publicId: r.publicId, active: r.active, createdAt: r.createdAt.toISOString(), eventCount: r._count.events }));
}

export async function listInboundEvents(projectId: string, limit = 25) {
  const rows = await prisma.inboundWebhookEvent.findMany({
    where: { endpoint: { projectId } },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: { id: true, eventId: true, receivedAt: true, payload: true, endpoint: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, eventId: r.eventId, endpoint: r.endpoint.name, receivedAt: r.receivedAt.toISOString(), preview: r.payload.slice(0, 200) }));
}

export async function deleteInboundEndpoint(projectId: string, id: string) {
  const result = await prisma.inboundWebhookEndpoint.deleteMany({ where: { id, projectId } });
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

const EVENT_NAME = /^(\*|[a-z0-9][a-z0-9_.-]{0,63})$/;

export async function createSubscription(projectId: string, url: string, events: string[]) {
  const checked = validateOutboundUrl(url);
  if (!checked.ok) return { ok: false as const, error: checked.reason };
  const names = [...new Set(events.map((e) => e.trim()).filter(Boolean))];
  if (names.length === 0 || names.length > 20 || names.some((e) => !EVENT_NAME.test(e))) {
    return { ok: false as const, error: 'Enter up to 20 event names (letters, numbers, . _ -) or *.' };
  }
  const count = await prisma.webhookSubscription.count({ where: { projectId } });
  if (count >= MAX_SUBSCRIPTIONS_PER_PROJECT) return { ok: false as const, error: `A project can have up to ${MAX_SUBSCRIPTIONS_PER_PROJECT} subscriptions.` };
  const secret = generateWebhookSecret();
  const row = await prisma.webhookSubscription.create({
    data: { projectId, url: checked.url.toString(), secretEnc: encryptSecret(secret), events: names },
  });
  return { ok: true as const, subscription: row, secret };
}

export async function listSubscriptions(projectId: string) {
  const rows = await prisma.webhookSubscription.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, url: true, events: true, active: true, consecutiveFailures: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function listDeliveries(projectId: string, limit = 25) {
  const rows = await prisma.webhookDelivery.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, event: true, status: true, attempts: true, lastStatusCode: true, lastError: true, nextAttemptAt: true, createdAt: true, subscription: { select: { url: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    lastStatusCode: r.lastStatusCode,
    lastError: r.lastError,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    host: safeHost(r.subscription.url),
  }));
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function deleteSubscription(projectId: string, id: string) {
  const result = await prisma.webhookSubscription.deleteMany({ where: { id, projectId } });
  return result.count > 0;
}

/** Queues a delivery for every active subscription of the project that listens to `event`. */
export async function emitWebhookEvent(projectId: string, event: string, data: unknown, onlySubscriptionId?: string) {
  const subs = await prisma.webhookSubscription.findMany({
    where: { projectId, active: true, ...(onlySubscriptionId ? { id: onlySubscriptionId } : {}) },
    select: { id: true, events: true },
  });
  const matching = onlySubscriptionId ? subs : subs.filter((s) => s.events.includes('*') || s.events.includes(event));
  const createdAt = new Date().toISOString();
  for (const sub of matching) {
    const payload = JSON.stringify({ event, createdAt, data });
    await prisma.webhookDelivery.create({
      data: { subscriptionId: sub.id, projectId, event, payload: payload.slice(0, MAX_INBOUND_BYTES), nextAttemptAt: new Date() },
    });
  }
  return matching.length;
}

/** Delivers due webhooks with retries/backoff. Safe to run concurrently: each delivery is leased before sending. */
export async function processDueDeliveries(limit = 50, fetchImpl?: typeof fetch) {
  const now = new Date();
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    include: { subscription: true },
  });
  const send = fetchImpl ?? createSafeFetch({ timeoutMs: 8_000, maxBytes: 64 * 1024, maxRedirects: 0 });
  const summary = { attempted: 0, delivered: 0, failed: 0, retrying: 0 };

  for (const delivery of due) {
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: 'PENDING', nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
    });
    if (claimed.count === 0) continue;
    summary.attempted += 1;

    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const secret = decryptSecret(delivery.subscription.secretEnc);
      const timestamp = Math.floor(Date.now() / 1000);
      const response = await send(delivery.subscription.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-id': delivery.id,
          'x-webhook-timestamp': String(timestamp),
          'x-webhook-signature': signatureHeader(secret, timestamp, delivery.payload),
        },
        body: delivery.payload,
      });
      statusCode = response.status;
      if (response.status < 200 || response.status >= 300) error = `Receiver responded with HTTP ${response.status}.`;
    } catch (err) {
      error = err instanceof Error && err.name === 'SsrfError' ? err.message : 'Could not reach the receiver.';
    }

    const attempts = delivery.attempts + 1;
    if (!error) {
      summary.delivered += 1;
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SUCCESS', attempts, lastStatusCode: statusCode, lastError: null, deliveredAt: new Date(), nextAttemptAt: null },
        }),
        prisma.webhookSubscription.update({ where: { id: delivery.subscriptionId }, data: { consecutiveFailures: 0 } }),
      ]);
      continue;
    }

    const wait = backoffSeconds(attempts);
    if (wait === null) summary.failed += 1;
    else summary.retrying += 1;
    const failures = delivery.subscription.consecutiveFailures + 1;
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: wait === null ? 'FAILED' : 'PENDING',
          attempts,
          lastStatusCode: statusCode,
          lastError: error,
          nextAttemptAt: wait === null ? null : new Date(Date.now() + wait * 1000),
        },
      }),
      prisma.webhookSubscription.update({
        where: { id: delivery.subscriptionId },
        data: { consecutiveFailures: failures, ...(failures >= AUTO_DISABLE_AFTER_FAILURES ? { active: false } : {}) },
      }),
    ]);
  }
  return summary;
}

/** Housekeeping: drop old inbound events and finished deliveries. */
export async function pruneWebhookData(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const [events, deliveries, logs] = await Promise.all([
    prisma.inboundWebhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } }),
    prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: cutoff }, status: { not: 'PENDING' } } }),
    prisma.integrationApiLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return { events: events.count, deliveries: deliveries.count, apiLogs: logs.count };
}
