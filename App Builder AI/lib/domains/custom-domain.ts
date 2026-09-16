import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import { prisma } from '../prisma';
import { publishedPath } from '../publish/visibility';

const DOMAIN_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

function verificationRecordName(domain: string) {
  return `_appweaverai-verify.${domain}`;
}

export function normalizeDomain(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

export async function getProjectCustomDomain(projectId: string) {
  return prisma.projectCustomDomain.findUnique({
    where: { projectId },
    select: {
      domain: true,
      verificationToken: true,
      verifiedAt: true,
    },
  });
}

/**
 * Registers (or replaces) the custom domain a project wants to use, issuing
 * a fresh verification token. The domain is not live until `verifyProjectCustomDomain`
 * confirms the DNS TXT record.
 */
export async function setProjectCustomDomain(
  projectId: string,
  domainInput: string,
) {
  const domain = normalizeDomain(domainInput);

  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error('Enter a valid domain, e.g. app.yourcompany.com');
  }

  const conflicting = await prisma.projectCustomDomain.findUnique({
    where: { domain },
    select: { projectId: true },
  });
  if (conflicting && conflicting.projectId !== projectId) {
    throw new Error('This domain is already connected to another project.');
  }

  const token = randomBytes(16).toString('hex');

  const record = await prisma.projectCustomDomain.upsert({
    where: { projectId },
    create: {
      projectId,
      domain,
      verificationToken: token,
    },
    update: {
      domain,
      verificationToken: token,
      verifiedAt: null,
    },
    select: { domain: true, verificationToken: true, verifiedAt: true },
  });

  return record;
}

export async function removeProjectCustomDomain(projectId: string) {
  await prisma.projectCustomDomain
    .delete({ where: { projectId } })
    .catch(() => null);
}

/**
 * Checks the `_appweaverai-verify.<domain>` TXT record for the project's
 * verification token. On success, marks the domain verified so it can be
 * routed to by the middleware rewrite.
 */
export async function verifyProjectCustomDomain(projectId: string) {
  const record = await prisma.projectCustomDomain.findUnique({
    where: { projectId },
    select: { domain: true, verificationToken: true },
  });

  if (!record) {
    throw new Error('No custom domain is set up for this project yet.');
  }

  let found = false;
  try {
    const txtRecords = await resolveTxt(verificationRecordName(record.domain));
    found = txtRecords.some((chunks) =>
      chunks.join('').includes(record.verificationToken),
    );
  } catch {
    found = false;
  }

  if (!found) {
    return { verified: false as const };
  }

  await prisma.projectCustomDomain.update({
    where: { projectId },
    data: { verifiedAt: new Date() },
  });

  return { verified: true as const };
}

/**
 * Resolves a verified custom domain to the internal path that serves the
 * project's current published deployment. Used by middleware.ts to rewrite
 * incoming requests for that domain, and safe to call from the Edge runtime
 * only via the /api/domains/resolve route (this function itself needs Node's
 * Prisma client, so it must run in a Node-runtime route handler).
 */
export async function resolvePublishedPathForDomain(domain: string) {
  const record = await prisma.projectCustomDomain.findFirst({
    where: { domain: normalizeDomain(domain), verifiedAt: { not: null } },
    select: {
      project: {
        select: {
          slug: true,
          deletedAt: true,
          adminStatus: true,
          workspace: { select: { slug: true } },
          deployments: {
            where: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });

  const project = record?.project;
  if (
    !project ||
    project.deletedAt ||
    project.adminStatus !== 'ACTIVE' ||
    project.deployments.length === 0
  ) {
    return null;
  }

  return publishedPath(project.workspace.slug, project.slug);
}
