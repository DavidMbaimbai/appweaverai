'use client';

import { useState, useTransition } from 'react';

import { createProjectAction } from '@/lib/actions/projects';
import {
  generateLaunchKitAction,
  type LaunchKitResult,
} from '@/lib/actions/studio';
import { MAX_BRIEF_LENGTH } from '@/lib/studio/tools';
import type { StudioCredits } from './studio-workbench';

const Block = ({ title, text }: { title: string; text: string }) => (
  <section>
    <h3 className="mb-2 text-sm font-medium text-app-text">{title}</h3>
    <div className="whitespace-pre-wrap rounded-xl border border-app-border-subtle bg-app-surface p-4 text-sm text-app-text">
      {text}
    </div>
  </section>
);

export function LaunchWorkbench({ credits }: { credits?: StudioCredits }) {
  const [brief, setBrief] = useState('');
  const [kit, setKit] = useState<LaunchKitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [building, startBuild] = useTransition();

  function generate() {
    setKit(null);
    setError(null);
    startTransition(async () => setKit(await generateLaunchKitAction(brief)));
  }

  function build(prompt: string) {
    setError(null);
    startBuild(async () => {
      const formData = new FormData();
      formData.set('prompt', prompt);
      formData.set('planMode', 'false');
      const result = await createProjectAction(formData);
      if (result && 'error' in result && result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-app-text" htmlFor="launch-brief">
        One-prompt launch
        <span className="ml-2 font-normal text-app-text-muted">
          Describe your business idea. You get a brand, ads and a launch plan, then the app is built with that brand.
        </span>
      </label>
      <textarea
        id="launch-brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        maxLength={MAX_BRIEF_LENGTH}
        rows={5}
        className="w-full rounded-xl border border-app-border-subtle bg-app-surface p-3 text-sm text-app-text"
        placeholder="e.g. A booking app for independent hair salons in London, aimed at owners with 1 to 3 chairs."
      />
      <button
        type="button"
        onClick={generate}
        disabled={pending || building || brief.trim().length < 10}
        className="rounded-lg bg-app-text px-4 py-2 text-sm font-medium text-app-bg disabled:opacity-50">
        {pending
          ? 'Creating your launch kit…'
          : credits?.metered
            ? `Create launch kit · ${credits.launchKitCost} credits`
            : 'Create launch kit'}
      </button>
      {credits?.metered ? (
        <p className="text-xs text-app-text-muted">Balance: {credits.balance} credits.</p>
      ) : null}

      {kit && !kit.ok ? <p className="text-sm text-red-500">{kit.error}</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {kit?.ok ? (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => build(kit.buildPrompt)}
            disabled={building}
            className="rounded-lg bg-appweaver-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {building ? 'Starting your app…' : 'Build my app and landing page with this brand'}
          </button>
          <Block title="Brand kit" text={kit.brand} />
          <Block title="Ad pack" text={kit.adPack} />
          <Block title="30-day launch plan" text={kit.plan} />
          <Block title="Build prompt sent to the app builder" text={kit.buildPrompt} />
        </div>
      ) : null}
    </div>
  );
}
