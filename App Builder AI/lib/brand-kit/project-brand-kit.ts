import { prisma } from '../prisma';

export type BrandKitValues = {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
};

const EMPTY_BRAND_KIT: BrandKitValues = {
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
};

export async function getProjectBrandKit(
  projectId: string,
): Promise<BrandKitValues> {
  const record = await prisma.projectBrandKit.findUnique({
    where: { projectId },
    select: {
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      fontFamily: true,
    },
  });

  return record ?? EMPTY_BRAND_KIT;
}

const KIT_SELECT = {
  logoUrl: true,
  primaryColor: true,
  secondaryColor: true,
  accentColor: true,
  fontFamily: true,
} as const;

/** The user's account-level default kit, or null when none is saved. */
export async function getUserBrandKit(
  userId: string,
): Promise<BrandKitValues | null> {
  return prisma.userBrandKit.findUnique({
    where: { userId },
    select: KIT_SELECT,
  });
}

export function hasBrandKitValues(kit: BrandKitValues | null): kit is BrandKitValues {
  return !!kit && Object.values(kit).some((v) => !!v);
}

export async function saveUserBrandKit(
  userId: string,
  fields: BrandKitValues,
): Promise<BrandKitValues> {
  const data = {
    logoUrl: fields.logoUrl?.trim() || null,
    primaryColor: fields.primaryColor?.trim() || null,
    secondaryColor: fields.secondaryColor?.trim() || null,
    accentColor: fields.accentColor?.trim() || null,
    fontFamily: fields.fontFamily?.trim() || null,
  };
  return prisma.userBrandKit.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: KIT_SELECT,
  });
}

export async function updateProjectBrandKit(
  projectId: string,
  fields: Partial<BrandKitValues>,
): Promise<BrandKitValues> {
  const data = {
    logoUrl: fields.logoUrl?.trim() || null,
    primaryColor: fields.primaryColor?.trim() || null,
    secondaryColor: fields.secondaryColor?.trim() || null,
    accentColor: fields.accentColor?.trim() || null,
    fontFamily: fields.fontFamily?.trim() || null,
  };

  return prisma.projectBrandKit.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
    select: {
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      fontFamily: true,
    },
  });
}
