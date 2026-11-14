import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

const MAX_BODY_BYTES = 4096;
const BOT_RE = /(bot|crawler|spider|crawling|headless|lighthouse|facebookexternalhit|preview)/i;
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const KEY_RE = /^aw_[a-f0-9]{24}$/;
const ID_RE = /^[a-f0-9]{24}$/;

interface SiteInfo {
  id: string;
  origins: string[];
  enabled: boolean;
}
// Tiny in-process cache, including negative results, so random keys can't hammer the DB.
const siteCache = new Map<string, { site: SiteInfo | null; at: number }>();

async function getSite(publicKey: string): Promise<SiteInfo | null> {
  const hit = siteCache.get(publicKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.site;
  const row = await prisma.analyticsSite.findUnique({
    where: { publicKey },
    select: { id: true, allowedOrigins: true, enabled: true },
  });
  const site = row ? { id: row.id, origins: row.allowedOrigins, enabled: row.enabled } : null;
  if (siteCache.size > 5000) siteCache.clear();
  siteCache.set(publicKey, { site, at: Date.now() });
  return site;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

const drop = () => new NextResponse(null, { status: 204 });

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: Request) {
  if (BOT_RE.test(req.headers.get('user-agent') ?? '')) return drop();

  const limit = await rateLimit(`collect:${clientIp(req)}`, 300, 60_000);
  if (!limit.ok) return new NextResponse(null, { status: 429 });

  const raw = await req.text(); // sendBeacon sends text/plain, which avoids a CORS preflight
  if (raw.length > MAX_BODY_BYTES) return drop();
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return drop();
    body = parsed as Record<string, unknown>;
  } catch {
    return drop();
  }

  const key = str(body.k, 40);
  const name = str(body.n, 40);
  const visitorId = str(body.v, 24);
  const sessionId = str(body.s, 24);
  if (!key || !KEY_RE.test(key) || !name || !EVENT_NAME_RE.test(name)) return drop();
  if (!visitorId || !ID_RE.test(visitorId) || !sessionId || !ID_RE.test(sessionId)) return drop();

  const site = await getSite(key);
  if (!site || !site.enabled) return drop();

  // Origin allowlist (blocks casual abuse from other websites; not a security boundary).
  const origin = req.headers.get('origin');
  if (site.origins.length > 0) {
    let host = '';
    try {
      host = origin ? new URL(origin).hostname : '';
    } catch {
      /* invalid origin */
    }
    if (!site.origins.includes(host)) return drop();
  }

  const touch = (typeof body.u === 'object' && body.u !== null ? body.u : {}) as Record<string, unknown>;
  const value = typeof body.val === 'number' && Number.isFinite(body.val) ? body.val : null;
  const currency = typeof body.cur === 'string' && /^[A-Za-z]{3}$/.test(body.cur) ? body.cur.toUpperCase() : null;
  const isPurchase = name === 'purchase' && value !== null && value >= 0 && value <= 10_000_000;

  await prisma.analyticsEvent
    .create({
      data: {
        siteId: site.id,
        name,
        visitorId,
        sessionId,
        // Never store query strings or fragments: they can contain tokens or personal data.
        path: str(body.p, 200)?.split(/[?#]/)[0] ?? null,
        referrer: str(body.r, 100),
        utmSource: str(touch.utm_source, 100),
        utmMedium: str(touch.utm_medium, 100),
        utmCampaign: str(touch.utm_campaign, 100),
        utmContent: str(touch.utm_content, 100),
        value: isPurchase ? value : null,
        currency: isPurchase ? currency : null,
      },
    })
    .catch(() => undefined); // analytics must never produce errors for visitors

  return drop();
}