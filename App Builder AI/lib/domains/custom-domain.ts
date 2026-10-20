import { randomBytes } from 'node:crypto';
import { resolve4, resolveCname, resolveTxt } from 'node:dns/promises';

import { prisma } from '../prisma';
import { publishedPath } from '../publish/visibility';
import {
  classifyTxtLookup,
  getHostingDnsTargets,
  isApexDomain,
  verificationRecordName,
  type TxtLookupOutcome,
  type VerifyFailure,
} from './dns-guidance';
import {
  attachDomainToVercel,
  detachDomainFromVercel,
  type AttachResult,
} from './vercel';
import { getAppRootDomain } from './subdomain';

const DOMAIN_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

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

  const root = getAppRootDomain();
  if (domain === root || domain.endsWith(`.${root}`)) {
    throw new Error(
      `${root} domains are managed by AppWeaver. Pick a managed subdomain instead, or use your own domain.`,
    );
  }

  const conflicting = await prisma.projectCustomDomain.findUnique({
    where: { domain },
    select: { projectId: true, verifiedAt: true },
  });
  if (conflicting && conflicting.projectId !== projectId) {
    if (conflicting.verifiedAt) {
      throw new Error('This domain is already connected to another project.');
    }
    // An unverified claim must not lock the domain away from its real owner.
    await prisma.projectCustomDomain.delete({ where: { domain } });
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
  const existing = await prisma.projectCustomDomain.findUnique({
    where: { projectId },
    select: { domain: true },
  });
  await prisma.projectCustomDomain
    .delete({ where: { projectId } })
    .catch(() => null);
  if (existing) await detachDomainFromVercel(existing.domain);
}

export type RoutingCheck = { ok: boolean; message: string };

/** Best-effort check that the domain's routing record points at the platform. */
export async function checkDomainRouting(domain: string): Promise<RoutingCheck> {
  const targets = getHostingDnsTargets();
  try {
    if (isApexDomain(domain)) {
      const addresses = await resolve4(domain);
      return addresses.includes(targets.a)
        ? { ok: true, message: `A record points to ${targets.a}.` }
        : {
            ok: false,
            message: `The root domain resolves to ${addresses.join(', ')} instead of ${targets.a}. If you use an ALIAS/ANAME record this can be expected.`,
          };
    }
    const cnames = await resolveCname(domain);
    return cnames.some((c) => c.replace(/\.$/, '') === targets.cname)
      ? { ok: true, message: `CNAME points to ${targets.cname}.` }
      : {
          ok: false,
          message: `The CNAME points to ${cnames.join(', ')} instead of ${targets.cname}.`,
        };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return {
      ok: false,
      message:
        code === 'ENODATA' || code === 'ENOTFOUND'
          ? `No ${isApexDomain(domain) ? 'A' : 'CNAME'} record found for ${domain} yet.`
          : `Routing lookup failed (${code ?? 'unknown error'}).`,
    };
  }
}

export type VerifyResult =
  | {
      verified: true;
      attach: AttachResult;
      routing: RoutingCheck;
    }
  | (VerifyFailure & { routing: RoutingCheck });

/**
 * Checks the `_appweaverai-verify.<domain>` TXT record for the project's
 * verification token. On success, marks the domain verified so it can be
 * routed to by the proxy rewrite, and attaches it to the Vercel project when
 * the Domains API is configured.
 */
export async function verifyProjectCustomDomain(
  projectId: string,
): Promise<VerifyResult> {
  const record = await prisma.projectCustomDomain.findUnique({
    where: { projectId },
    select: { domain: true, verificationToken: true },
  });

  if (!record) {
    throw new Error('No custom domain is set up for this project yet.');
  }

  let outcome: TxtLookupOutcome;
  try {
    outcome = {
      kind: 'records',
      records: await resolveTxt(verificationRecordName(record.domain)),
    };
  } catch (error) {
    outcome = {
      kind: 'error',
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : undefined,
    };
  }

  const classified = classifyTxtLookup(
    record.domain,
    record.verificationToken,
    outcome,
  );
  const routing = await checkDomainRouting(record.domain);

  if (!classified.verified) {
    return { ...classified, routing };
  }

  await prisma.projectCustomDomain.update({
    where: { projectId },
    data: { verifiedAt: new Date() },
  });

  const attach = await attachDomainToVercel(record.domain);
  return { verified: true, attach, routing };
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

/** Same as the custom-domain resolver, for a managed `<label>.<root>` subdomain. */
export async function resolvePublishedPathForSubdomain(label: string) {
  const record = await prisma.projectSubdomain.findUnique({
    where: { subdomain: label.toLowerCase() },
    select: { projectId: true },
  });
  if (!record) return null;

  const project = await prisma.project.findUnique({
    where: { id: record.projectId },
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
  });

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

/** Custom domains already connected across the user's other projects. */
export async function countUserCustomDomains(
  userId: string,
  excludeProjectId: string,
) {
  return prisma.projectCustomDomain.count({
    where: {
      projectId: { not: excludeProjectId },
      project: {
        deletedAt: null,
        OR: [{ createdById: userId }, { workspace: { ownerId: userId } }],
      },
    },
  });
}