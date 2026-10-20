import { PageHeader } from '@/components/app/shell/page-header';
import { StudioWorkbench } from '@/components/app/studio/studio-workbench';

export const dynamic = 'force-dynamic';

export default function StudioPage() {
  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Studio" />
      <div className="mx-auto w-full max-w-app-content flex-1 px-4 py-6 tablet-up:px-8">
        <p className="mb-6 text-sm text-app-text-muted">
          Design, marketing, advertising and strategy in one place. Describe what you need and
          AI produces it. Ready to build? Turn the result into an app from Home.
        </p>
        <StudioWorkbench />
      </div>
    </main>
  );
}
