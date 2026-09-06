export type AgentActivity = {
  isWorking: boolean;
  artifactId: string | null;
  /** Full project file path, e.g. main/components/Hero.jsx */
  activeFilePath: string | null;
  activeAction: string | null;
};

export const idleAgentActivity: AgentActivity = {
  isWorking: false,
  artifactId: null,
  activeFilePath: null,
  activeAction: null,
};

export function fileNameFromAgentPath(path: string) {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

export function artifactSlugFromAgentPath(path: string) {
  return path.split('/')[0] ?? '';
}

export function isAgentWorkingOnArtifact(
  activity: AgentActivity,
  artifactId: string,
) {
  return activity.isWorking && activity.artifactId === artifactId;
}

export function isAgentWorkingOnFile(
  activity: AgentActivity,
  artifactSlug: string,
  relativePath: string,
) {
  if (!activity.isWorking || !activity.activeFilePath) return false;
  return activity.activeFilePath === `${artifactSlug}/${relativePath}`;
}
