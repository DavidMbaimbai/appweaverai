import { prisma } from '@/lib/prisma';

/** Growth tables carry no foreign keys, so account erasure must remove the user's rows explicitly. */
export async function eraseGrowthUserData(userId: string) {
  const [attribution, features] = await prisma.$transaction([
    prisma.growthAttribution.deleteMany({ where: { userId } }),
    prisma.growthFeatureEvent.deleteMany({ where: { userId } }),
  ]);
  return { attribution: attribution.count, features: features.count };
}
