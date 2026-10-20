'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  addSceneAction,
  createVideoProjectAction,
  deleteVideoProjectAction,
  getSceneJobStatusesAction,
} from '@/lib/actions/video';

import { SceneCard, isActive, type SceneJob, type SceneView } from './scene-card';

export type ProjectView = {
  id: string;
  title: string;
  kind: 'STANDALONE' | 'SERIES';
  scenes: SceneView[];
};

const inputClass =
  'rounded-lg border border-app-border-subtle bg-app-surface px-3 py-2 text-sm text-app-text';
const ghostButton =
  'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';

export function VideoStudio({
  projects,
  usedThisMonth,
  monthlyLimit,
}: {
  projects: ProjectView[];
  usedThisMonth: number;
  monthlyLimit: number;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'STANDALONE' | 'SERIES'>('STANDALONE');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Polled job states are only trusted while they belong to the current server data.
  const [overlay, setOverlay] = useState<{ base: ProjectView[]; jobs: Map<string, SceneJob | null> } | null>(null);

  const selected = projects.find((project) => project.id === selectedId) ?? projects[0] ?? null;
  const liveJobs = overlay?.base === projects ? overlay.jobs : null;
  const scenes = (selected?.scenes ?? []).map((scene) =>
    liveJobs?.has(scene.id) ? { ...scene, job: liveJobs.get(scene.id) ?? null } : scene,
  );
  const polling = scenes.some((scene) => isActive(scene.job));

  useEffect(() => {
    if (!selected || !polling) return;
    const projectId = selected.id;
    let stopped = false;
    const tick = async () => {
      const result = await getSceneJobStatusesAction(projectId);
      if (stopped || !result.ok) return;
      const jobs = new Map<string, SceneJob | null>();
      for (const status of result.statuses) {
        jobs.set(
          status.sceneId,
          status.jobId && status.status
            ? {
                id: status.jobId,
                status: status.status,
                progress: status.progress,
                error: status.error,
                costCents: status.costCents,
              }
            : null,
        );
      }
      setOverlay({ base: projects, jobs });
      if (result.statuses.some((s) => s.status === 'SUCCEEDED' || s.status === 'FAILED')) {
        router.refresh();
      }
    };
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selected, polling, projects, router]);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createVideoProjectAction(title, kind);
      if (!result.ok) return setError(result.error);
      setTitle('');
      setSelectedId(result.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-app-text-muted">
        {usedThisMonth} of {monthlyLimit} videos used this month. Each clip is 16:9 and priced before you
        confirm.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-app-text">
          New project
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
            placeholder="Title" className={inputClass} />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
          aria-label="Project type" className={inputClass}>
          <option value="STANDALONE">Standalone video</option>
          <option value="SERIES">Series (seasons and episodes)</option>
        </select>
        <button type="button" onClick={create} disabled={pending || !title.trim()}
          className="rounded-lg bg-app-text px-4 py-2 text-sm font-medium text-app-bg disabled:opacity-50">
          Create
        </button>
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {projects.length === 0 ? (
        <p className="text-sm text-app-text-muted">No video projects yet. Create one to start adding scenes.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {projects.map((project) => (
            <button key={project.id} type="button" onClick={() => setSelectedId(project.id)}
              aria-pressed={project.id === selected?.id}
              className={`${ghostButton} ${project.id === selected?.id ? 'bg-app-surface-active' : ''}`}>
              {project.title}
              {project.kind === 'SERIES' ? ' (series)' : ''}
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium text-app-text">{selected.title}</h2>
            <button type="button" disabled={pending} className={`${ghostButton} ml-auto`}
              onClick={() => {
                if (!window.confirm('Delete this project and its scenes?')) return;
                startTransition(async () => {
                  await deleteVideoProjectAction(selected.id);
                  setSelectedId(null);
                  router.refresh();
                });
              }}>
              Delete project
            </button>
          </div>
          {scenes.map((scene, index) => (
            <SceneCard key={scene.id} scene={scene} index={index} total={scenes.length}
              series={selected.kind === 'SERIES'} />
          ))}
          <button type="button" disabled={pending} className={ghostButton}
            onClick={() =>
              startTransition(async () => {
                const result = await addSceneAction(selected.id);
                if (!result.ok) setError(result.error);
                router.refresh();
              })
            }>
            Add scene
          </button>
        </section>
      ) : null}
    </div>
  );
}
