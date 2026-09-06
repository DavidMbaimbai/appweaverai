import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeProjectFile } from '@/lib/project-files';

const COMPONENT_ORDER = [
  'Navbar',
  'Header',
  'Hero',
  'Featured',
  'Categories',
  'Products',
  'Footer',
];

async function fileExists(absolutePath: string) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function componentNameFromPath(relativePath: string) {
  return path.basename(relativePath, path.extname(relativePath));
}

function sortComponents(paths: string[]) {
  return [...paths].sort((a, b) => {
    const nameA = componentNameFromPath(a);
    const nameB = componentNameFromPath(b);
    const indexA = COMPONENT_ORDER.indexOf(nameA);
    const indexB = COMPONENT_ORDER.indexOf(nameB);

    if (indexA === -1 && indexB === -1) return nameA.localeCompare(nameB);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}

function buildAppSource(componentPaths: string[]) {
  const imports = componentPaths
    .map((relativePath) => {
      const name = componentNameFromPath(relativePath);
      const importPath = `./${relativePath.replace(/\\/g, '/')}`;
      return `import ${name} from '${importPath}'`;
    })
    .join('\n');

  const elements = componentPaths
    .map((relativePath) => {
      const name = componentNameFromPath(relativePath);
      return `      <${name} />`;
    })
    .join('\n');

  return `${imports}

export default function App() {
  return (
    <>
${elements}
    </>
  )
}
`;
}

/**
 * Agent sometimes writes main.jsx + components/ but forgets App.jsx.
 * Synthesize a root App from flat component files so preview can bundle.
 */
export async function ensureReactEntryFiles(
  absoluteDir: string,
  relativePaths: string[],
  options?: {
    projectId: string;
    artifactSlug: string;
    artifactId?: string | null;
  },
) {
  const appCandidates = ['App.jsx', 'App.tsx'];
  for (const candidate of appCandidates) {
    if (await fileExists(path.join(absoluteDir, candidate))) {
      return relativePaths;
    }
  }

  const entryCandidates = ['main.jsx', 'main.tsx', 'index.jsx', 'index.tsx'];
  let entryContent = '';

  for (const candidate of entryCandidates) {
    const absolute = path.join(absoluteDir, candidate);
    if (!(await fileExists(absolute))) continue;
    entryContent = await readFile(absolute, 'utf8');
    break;
  }

  if (!entryContent.includes('./App') && !entryContent.includes("'App'")) {
    return relativePaths;
  }

  const componentPaths = sortComponents(
    relativePaths.filter((filePath) =>
      /^components\/[^/]+\.(jsx|tsx)$/i.test(filePath),
    ),
  );

  if (componentPaths.length === 0) {
    return relativePaths;
  }

  const appFileName = entryContent.includes('App.tsx') ? 'App.tsx' : 'App.jsx';
  const appSource = buildAppSource(componentPaths);
  await writeFile(path.join(absoluteDir, appFileName), appSource, 'utf8');

  if (options) {
    await writeProjectFile({
      projectId: options.projectId,
      artifactSlug: options.artifactSlug,
      artifactId: options.artifactId,
      relativePath: appFileName,
      content: appSource,
    });
  }

  if (relativePaths.includes(appFileName)) {
    return relativePaths;
  }

  return [...relativePaths, appFileName];
}
