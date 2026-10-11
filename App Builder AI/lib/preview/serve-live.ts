import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { getProjectBrandKit } from '@/lib/brand-kit/project-brand-kit';
import { injectBrandKitShim } from '@/lib/preview/brand-kit-shim';
import { injectFormSubmitShim } from '@/lib/preview/form-submit-shim';
import { injectRuntimeErrorShim } from '@/lib/preview/runtime-error-shim';
import { getMimeType, injectPreviewBaseHref } from '@/lib/project-files';
import { publishedSnapshotDir } from '@/lib/publish/snapshot';

const EMPTY_BRAND_KIT = {
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
};

/** Serves a file from the frozen published snapshot, or null if there is none. */
export async function serveLiveFile(
  projectId: string,
  artifactSlug: string,
  relativePath: string,
) {
  const root = publishedSnapshotDir(projectId, artifactSlug);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(path.resolve(root))) throw new Error('Invalid path.');

  const fileStat = await stat(absolute).catch(() => null);
  if (!fileStat?.isFile()) return null;

  const content = await readFile(absolute);
  const contentType = getMimeType(relativePath);

  if (!contentType.startsWith('text/html')) {
    return { body: content, contentType };
  }

  const based = injectPreviewBaseHref(
    content.toString('utf8'),
    projectId,
    artifactSlug,
    'live',
  );
  if (relativePath !== 'index.html') {
    return { body: based, contentType };
  }

  const brandKit = await getProjectBrandKit(projectId).catch(() => null);
  return {
    body: injectFormSubmitShim(
      injectRuntimeErrorShim(injectBrandKitShim(based, brandKit ?? EMPTY_BRAND_KIT)),
    ),
    contentType,
  };
}
