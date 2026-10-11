import { PageHeader } from '@/components/app/shell/page-header';
import { listWebsiteTemplates } from '@/lib/queries/templates';
import { TemplatesGallery } from '@/components/app/templates/templates-gallery';

// Template data is read from the database at request time; this route has
// no searchParams/cookies usage to otherwise opt it out of static
// prerendering, so it's marked dynamic explicitly (matching how other
// dashboard pages rely on cookies()-driven dynamic rendering).
export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const templates = await listWebsiteTemplates({ kind: 'FULL_TEMPLATE' });
  const sections = await listWebsiteTemplates({ kind: 'SECTION' });

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Templates" />

      <div className="mx-auto w-full max-w-app-content flex-1 px-4 py-6 tablet-up:px-8">
        <p className="mb-6 text-sm text-app-text-muted">
          Start a new website from a ready-made template, or open an existing
          project and insert sections from the editor&apos;s Library panel.
        </p>

        <TemplatesGallery templates={templates} sections={sections} />
      </div>
    </main>
  );
}
