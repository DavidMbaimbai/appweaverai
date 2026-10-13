import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { getProjectBrandKit } from '@/lib/brand-kit/project-brand-kit';
import { injectBrandKitShim } from '@/lib/preview/brand-kit-shim';
import { injectFormSubmitShim } from '@/lib/preview/form-submit-shim';
import { injectRuntimeErrorShim } from '@/lib/preview/runtime-error-shim';
import { getMimeType, injectPreviewBaseHref } from '@/lib/project-files';
import { injectSeoTags } from '@/lib/preview/seo-shim';
import {
  PUBLISH_META_FILE,
  publishedSnapshotDir,
  readPublishMeta,
} from '@/lib/publish/snapshot';

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
  if (path.basename(relativePath) === PUBLISH_META_FILE) return null;

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
  // Use the values frozen at publish time so brand kit/SEO edits stay drafts
  // until the user republishes; older snapshots fall back to the current ones.
  const meta = await readPublishMeta(projectId, artifactSlug);
  const brandKit =
    meta?.brandKit ??
    (await getProjectBrandKit(projectId).catch(() => null)) ??
    EMPTY_BRAND_KIT;
  const withSeo =
    relativePath === 'index.html' && meta
      ? injectSeoTags(based, meta.seo)
      : based;
  return {
    body: injectFormSubmitShim(
      injectRuntimeErrorShim(injectBrandKitShim(withSeo, brandKit)),
    ),
    contentType,
  };
}
