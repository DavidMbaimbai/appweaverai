import { prisma } from '../prisma';
import {
  subdomainHost,
  validateSubdomain,
  type SubdomainValidation,
} from './subdomain';

export async function getProjectSubdomain(projectId: string) {
  const record = await prisma.projectSubdomain.findUnique({
    where: { projectId },
    select: { subdomain: true },
  });
  return record ? { subdomain: record.subdomain, host: subdomainHost(record.subdomain) } : null;
}

/** True if no other live project already owns `subdomain`. */
export async function isSubdomainAvailable(
  subdomain: string,
  projectId: string,
): Promise<boolean> {
  const existing = await prisma.projectSubdomain.findUnique({
    where: { subdomain },
    select: { projectId: true },
  });
  if (!existing || existing.projectId === projectId) return true;

  // Rows are not FK-linked; a vanished project must not hold the name forever.
  const owner = await prisma.project.findUnique({
    where: { id: existing.projectId },
    select: { id: true },
  });
  if (!owner) {
    await prisma.projectSubdomain
      .delete({ where: { subdomain } })
      .catch(() => null);
    return true;
  }
  return false;
}

export async function setProjectSubdomain(
  projectId: string,
  input: string,
): Promise<SubdomainValidation & { host?: string }> {
  const validation = validateSubdomain(input);
  if (!validation.ok) return validation;

  const subdomain = validation.value;
  const taken = { ok: false as const, error: 'That subdomain is already taken.' };

  if (!(await isSubdomainAvailable(subdomain, projectId))) return taken;

  try {
    await prisma.projectSubdomain.upsert({
      where: { projectId },
      create: { projectId, subdomain },
      update: { subdomain },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return taken;
    throw error;
  }

  return { ok: true, value: subdomain, host: subdomainHost(subdomain) };
}

export async function removeProjectSubdomain(projectId: string) {
  await prisma.projectSubdomain
    .delete({ where: { projectId } })
    .catch(() => null);
}
