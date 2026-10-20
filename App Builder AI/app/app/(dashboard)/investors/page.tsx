import Link from 'next/link';
import { notFound } from 'next/navigation';

import { InvestorHub } from '@/components/app/investors/investor-hub';
import { PageHeader } from '@/components/app/shell/page-header';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

export const dynamic = 'force-dynamic';

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();
  const { project: requested } = await searchParams;

  const projects = await prisma.project.findMany({
    where: projectAccessWhere(userId),
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, name: true },
  });
  const active = projects.find((p) => p.id === requested) ?? projects[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title="Investor Hub">
        {projects.length > 1 && (
          <nav className="flex gap-2 text-sm">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/app/investors?project=${p.id}`}
                className={p.id === active?.id ? 'font-medium text-app-text' : 'text-app-text-muted'}>
                {p.name}
              </Link>
            ))}
          </nav>
        )}
      </PageHeader>
      {active ? (
        <InvestorHub key={active.id} projectId={active.id} />
      ) : (
        <p className="p-6 text-sm text-app-text-muted">Create a project first, then use the Investor Hub to plan its fundraising.</p>
      )}
    </div>
  );
}
