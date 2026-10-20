import { PageHeader } from '@/components/app/shell/page-header';
import { LaunchWorkbench } from '@/components/app/studio/launch-workbench';
import { StudioWorkbench } from '@/components/app/studio/studio-workbench';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const userId = (await getCachedSession())?.user?.id;
  const saved =
    userId && process.env.DATABASE_URL
      ? await prisma.launchKit.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      : [];

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Studio" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-10 px-4 py-6 tablet-up:px-8">
        <p className="text-sm text-app-text-muted">
          Design, marketing, advertising and strategy in one place. Describe what you need and
          AI produces it.
        </p>
        <LaunchWorkbench />
        {saved.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-medium text-app-text">Your saved launch kits</h2>
            <div className="space-y-2">
              {saved.map((kit) => (
                <details key={kit.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
                  <summary className="cursor-pointer text-sm text-app-text">
                    {kit.brief.slice(0, 90)}
                    <span className="ml-2 text-xs text-app-text-muted">{kit.createdAt.toLocaleDateString('en-GB')}</span>
                  </summary>
                  <div className="mt-3 space-y-4 whitespace-pre-wrap text-sm text-app-text-secondary">
                    <div><strong>Brand kit</strong>{'\n'}{kit.brand}</div>
                    <div><strong>Ad pack</strong>{'\n'}{kit.adPack}</div>
                    <div><strong>30-day plan</strong>{'\n'}{kit.plan}</div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ) : null}
        <hr className="border-app-border-subtle" />
        <StudioWorkbench />
      </div>
    </main>
  );
}
