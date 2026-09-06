import { ProjectsPage } from '@/components/app/dashbaord/projects-page';
import { getCachedSession, getCachedUserWorkspaces } from '@/lib/auth/cached';
import { getProjectsForUser } from '@/lib/queries/projects';

export default async function AppProjectsPage() {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  const projects =
    userId && process.env.DATABASE_URL
      ? await getProjectsForUser({
          userId,
          workspaces: await getCachedUserWorkspaces(userId).then((items) =>
            items.map((item) => ({
              id: item.id,
              name: item.name,
              slug: item.slug,
            })),
          ),
        })
      : [];

  return <ProjectsPage projects={projects} />;
}
