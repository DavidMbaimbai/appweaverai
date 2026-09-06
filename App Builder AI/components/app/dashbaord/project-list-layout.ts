import { artifactTypeLabels } from '@/lib/app-types';
import type { ArtifactType } from '@/lib/generated/prisma/client';

export const PROJECT_LIST_GRID =
  'desktop:grid desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7.5rem_6.5rem_10.5rem] desktop:items-start desktop:gap-x-8';

export function projectDisplaySubtitle(project: {
  name: string;
  description: string | null;
}) {
  if (!project.description) return null;

  const desc = project.description.trim().toLowerCase();
  const name = project.name.trim().toLowerCase();

  if (desc === name) return null;
  if (desc.startsWith(name.slice(0, Math.min(name.length, 48)))) return null;

  return project.description;
}

export function projectMetaLine(project: {
  workspaceName: string;
  artifacts: { type: ArtifactType }[];
  fileCount: number;
}) {
  const types = [
    ...new Set(project.artifacts.map((artifact) => artifact.type)),
  ];
  const typeLabel =
    types.length === 0
      ? 'No artifacts'
      : types.length === 1
        ? artifactTypeLabels[types[0]!]
        : `${types.length} types`;

  const files =
    project.fileCount === 0
      ? 'No files'
      : `${project.fileCount} file${project.fileCount === 1 ? '' : 's'}`;

  return `${project.workspaceName} . ${typeLabel} . ${files}`;
}
