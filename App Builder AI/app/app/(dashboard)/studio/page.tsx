import { PageHeader } from '@/components/app/shell/page-header';
import { LaunchWorkbench } from '@/components/app/studio/launch-workbench';
import { StudioWorkbench } from '@/components/app/studio/studio-workbench';

export const dynamic = 'force-dynamic';

export default function StudioPage() {
  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Studio" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-10 px-4 py-6 tablet-up:px-8">
        <p className="text-sm text-app-text-muted">
          Design, marketing, advertising and strategy in one place. Describe what you need and
          AI produces it.
        </p>
        <LaunchWorkbench />
        <hr className="border-app-border-subtle" />
        <StudioWorkbench />
      </div>
    </main>
  );
}
