import { PROMPT_ATTACHMENTS_DIR } from './prompt-attachments';
import type {
  ArtifactStatus,
  ArtifactType,
} from '@/lib/generated/prisma/client';
import type { ProjectCategory } from './types';
import { artifactTypeLabels, type AppAgentMessage } from './app-types';

export const MAX_ARTIFACTS_PER_PROJECT = 7;
export const MIN_ARTIFACTS_PER_PROJECT = 1;

export const agentBuildableArtifactTypes = [
  'WEB_APP',
  'MOBILE_APP',
  'DESIGN',
] as const satisfies readonly ArtifactType[];

export function artifactSupportsAgentBuild(type: ArtifactType) {
  return (agentBuildableArtifactTypes as readonly ArtifactType[]).includes(
    type,
  );
}

export function artifactHasFiles(
  files: Array<{ path: string }>,
  artifactSlug: string,
) {
  return files.some((file) => {
    if (!file.path.startsWith(`${artifactSlug}/`)) return false;
    const relative = file.path.slice(`${artifactSlug}/`.length);
    return !relative.startsWith(`${PROMPT_ATTACHMENTS_DIR}/`);
  });
}

export function artifactHasPreviewContent(
  artifact: { slug: string; status: ArtifactStatus },
  files: Array<{ path: string }>,
  messages: AppAgentMessage[] = [],
) {
  if (artifactHasFiles(files, artifact.slug)) return true;
  if (artifact.status === 'READY') return true;

  const prefix = `${artifact.slug}/`;
  return messages.some((message) =>
    message.metadata?.fileWrites?.some((file) => file.path.startsWith(prefix)),
  );
}

export function getArtifactEmptyStateMessage(type: ArtifactType) {
  if (!artifactSupportsAgentBuild(type)) {
    return {
      description: `${artifactTypeLabels[type]} artifacts are not supported yet.`,
      hint: 'Switch to Web app or Mobile app, or add a new artifact with +.',
    };
  }

  switch (type) {
    case 'DESIGN':
      return {
        description: 'Design mockups and wireframes will appear here.',
        hint: 'Ask Agent to build a layout, or use Plan mode to iterate without writing files.',
      };
    case 'MOBILE_APP':
      return {
        description: 'A mobile-focused preview will render here.',
        hint: 'Select this tab and ask Agent to build a phone-sized version.',
      };
    default:
      return {
        description: 'Live preview will render here as Agent builds your app.',
        hint: 'Select this tab and tell Agent what to build.',
      };
  }
}

/** Build types users can add from the + button in the editor. */
export const addableArtifactTypes: Array<{
  type: ArtifactType;
  label: string;
  icon: ProjectCategory['icon'];
}> = [
  { type: 'WEB_APP', label: artifactTypeLabels.WEB_APP, icon: 'website' },
  { type: 'MOBILE_APP', label: artifactTypeLabels.MOBILE_APP, icon: 'mobile' },
  { type: 'DESIGN', label: artifactTypeLabels.DESIGN, icon: 'design' },
];
