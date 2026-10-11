import { ProjectEditor } from '@/components/app/editor/project-editor';
import { getCachedSession } from '@/lib/auth/cached';
import { getAppTier } from '@/lib/billing/entitlements';
import { getUserBillingFields } from '@/lib/queries/billing';
import { getProjectBySlugs } from '@/lib/queries/projects';
import { listWebsiteTemplates } from '@/lib/queries/templates';
import { notFound } from 'next/navigation';

type ProjectPageProps = {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
  }>;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId || !process.env.DATABASE_URL) {
    notFound();
  }

  const { workspaceSlug, projectSlug } = await params;
  const project = await getProjectBySlugs(userId, workspaceSlug, projectSlug);

  if (!project) {
    notFound();
  }

  const [billingUser, sections] = await Promise.all([
    getUserBillingFields(userId),
    listWebsiteTemplates({ kind: 'SECTION' }),
  ]);

  return (
    <ProjectEditor
      project={project}
      appTier={getAppTier(billingUser)}
      sections={sections}
    />
  );
}
