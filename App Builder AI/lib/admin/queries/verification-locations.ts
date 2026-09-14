import { prisma } from '@/lib/prisma';

export type VerificationLocation = {
  lat: number;
  lon: number;
  city: string | null;
  region: string | null;
  country: string | null;
  createdAt: Date;
};

type LocationMetadata = {
  lat?: unknown;
  lon?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
};

/**
 * Recent email-verification locations (see
 * lib/auth/record-auth-activity.ts#recordEmailVerificationLocation),
 * used to plot pins on the public rotating-globe footer icon and on the
 * Admin Console's Analytics page. Only approximate lat/lon + city/country
 * are returned — no user-identifying information.
 */
export async function getRecentVerificationLocations(
  limit = 25,
): Promise<VerificationLocation[]> {
  const events = await prisma.securityEvent.findMany({
    where: { type: 'EMAIL_VERIFIED' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { metadata: true, createdAt: true },
  });

  const locations: VerificationLocation[] = [];

  for (const event of events) {
    const metadata = event.metadata as LocationMetadata | null;
    if (!metadata) continue;

    const lat = typeof metadata.lat === 'number' ? metadata.lat : null;
    const lon = typeof metadata.lon === 'number' ? metadata.lon : null;
    if (lat === null || lon === null) continue;

    locations.push({
      lat,
      lon,
      city: typeof metadata.city === 'string' ? metadata.city : null,
      region: typeof metadata.region === 'string' ? metadata.region : null,
      country: typeof metadata.country === 'string' ? metadata.country : null,
      createdAt: event.createdAt,
    });
  }

  return locations;
}
