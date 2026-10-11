import { prisma } from '../prisma';

export type ProjectSeoFields = {
  seoTitle: string | null;
  seoDescription: string | null;
  seoImageUrl: string | null;
  faviconUrl: string | null;
};

export async function getProjectSeo(
  projectId: string,
): Promise<ProjectSeoFields | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      seoTitle: true,
      seoDescription: true,
      seoImageUrl: true,
      faviconUrl: true,
    },
  });
}

export async function updateProjectSeo(
  projectId: string,
  fields: Partial<ProjectSeoFields>,
): Promise<ProjectSeoFields> {
  return prisma.project.update({
    where: { id: projectId },
    data: {
      seoTitle: fields.seoTitle?.trim() || null,
      seoDescription: fields.seoDescription?.trim() || null,
      seoImageUrl: fields.seoImageUrl?.trim() || null,
      faviconUrl: fields.faviconUrl?.trim() || null,
    },
    select: {
      seoTitle: true,
      seoDescription: true,
      seoImageUrl: true,
      faviconUrl: true,
    },
  });
}
