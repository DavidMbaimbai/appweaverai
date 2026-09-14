const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export type GeoLocation = {
  lat: number;
  lon: number;
  city: string | null;
  region: string | null;
  country: string | null;
  ip: string | null;
};

function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

/**
 * Resolves an approximate geographic location for an IP address using the
 * free ip-api.com lookup service (no API key required). Falls back to
 * geolocating the server's own outbound connection (i.e. "self") when the
 * supplied IP is missing or a private/loopback address — this keeps the
 * feature demonstrable in local development, where request IPs are always
 * private, while still resolving a real public IP in production behind a
 * proxy that sets x-forwarded-for.
 *
 * Best-effort: returns null on any failure (rate limit, network error,
 * reserved-range lookup failure, etc.) and must never throw.
 */
export async function lookupIpLocation(
  ipAddress: string | null | undefined,
): Promise<GeoLocation | null> {
  try {
    const target = isPrivateIp(ipAddress) ? '' : encodeURIComponent(ipAddress!);
    const response = await fetch(
      `http://ip-api.com/json/${target}?fields=status,message,country,regionName,city,lat,lon,query`,
      { signal: AbortSignal.timeout(4000) },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      status: string;
      message?: string;
      country?: string;
      regionName?: string;
      city?: string;
      lat?: number;
      lon?: number;
      query?: string;
    };

    if (
      data.status !== 'success' ||
      typeof data.lat !== 'number' ||
      typeof data.lon !== 'number'
    ) {
      return null;
    }

    return {
      lat: data.lat,
      lon: data.lon,
      city: data.city ?? null,
      region: data.regionName ?? null,
      country: data.country ?? null,
      ip: data.query ?? (isPrivateIp(ipAddress) ? null : (ipAddress ?? null)),
    };
  } catch (error) {
    console.error('IP geolocation lookup failed:', error);
    return null;
  }
}

/**
 * Best-effort extraction of a human-readable "City, Country" string from an
 * arbitrary JSON blob (e.g. AdminAuditLog.after / SecurityEvent.metadata)
 * that may or may not contain a GeoLocation shape. Returns null when the
 * value doesn't look like a location.
 */
export function formatLocationFromJson(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const city = typeof record.city === 'string' ? record.city : null;
  const region = typeof record.region === 'string' ? record.region : null;
  const country = typeof record.country === 'string' ? record.country : null;
  const lat = typeof record.lat === 'number' ? record.lat : null;
  const lon = typeof record.lon === 'number' ? record.lon : null;

  if (lat === null || lon === null) return null;

  const parts = [city, region && region !== city ? region : null, country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(', ') : `${lat.toFixed(1)}, ${lon.toFixed(1)}`;
}
