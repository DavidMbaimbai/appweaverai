import { PROMPT_ATTACHMENTS_DIR } from '@/lib/prompt-attachments';
import { readProjectFile } from '@/lib/project-files';

const MAX_SNAPSHOT_CHARS = 24_000;

const ENTRY_PRIORITY = [
  'index.html',
  'main.jsx',
  'main.tsx',
  'main.js',
  'App.jsx',
  'App.tsx',
  'script.js',
  'index.css',
];

function relativePathFromDb(artifactSlug: string, dbPath: string) {
  const prefix = `${artifactSlug}/`;
  return dbPath.startsWith(prefix) ? dbPath.slice(prefix.length) : dbPath;
}

function scorePath(relativePath: string) {
  const entryIndex = ENTRY_PRIORITY.indexOf(relativePath);
  if (entryIndex >= 0) return entryIndex;

  if (relativePath.startsWith('components/'))
    return 20 + relativePath.length / 100;
  if (relativePath.endsWith('.css')) return 40;
  if (relativePath.endsWith('.jsx') || relativePath.endsWith('.tsx')) return 30;
  return 50;
}

function truncateContent(content: string, maxChars: number) {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n… [truncated]`;
}

export async function buildArtifactContextSnapshot({
  projectId,
  artifactSlug,
  artifactFiles,
}: {
  projectId: string;
  artifactSlug: string;
  artifactFiles: Array<{ path: string; updatedAt: string }>;
}) {
  if (artifactFiles.length === 0) {
    return 'none yet';
  }

  const relativeFiles = artifactFiles
    .map((file) => ({
      relativePath: relativePathFromDb(artifactSlug, file.path),
      updatedAt: file.updatedAt,
    }))
    .filter(
      (file) =>
        file.relativePath &&
        !file.relativePath.includes('..') &&
        !file.relativePath.startsWith(`${PROMPT_ATTACHMENTS_DIR}/`),
    )
    .sort((a, b) => {
      const scoreDiff = scorePath(a.relativePath) - scorePath(b.relativePath);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const fileList = relativeFiles.map((file) => file.relativePath).join(', ');
  const sections: string[] = [];
  let usedChars = 0;

  for (const file of relativeFiles) {
    if (usedChars >= MAX_SNAPSHOT_CHARS) break;

    const content = await readProjectFile(
      projectId,
      artifactSlug,
      file.relativePath,
    );
    if (content == null) continue;

    const remaining = MAX_SNAPSHOT_CHARS - usedChars;
    const snippet = truncateContent(content, Math.min(remaining, 4000));
    sections.push(`--- ${file.relativePath} ---\n${snippet}`);
    usedChars += snippet.length + file.relativePath.length + 8;
  }

  if (sections.length === 0) {
    return fileList;
  }

  return `Files: ${fileList}\n\nCurrent artifact snapshot:\n${sections.join('\n\n')}`;
}
