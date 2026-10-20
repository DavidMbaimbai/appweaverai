import { createHash } from 'node:crypto';
import { z } from 'zod';

import { LIMITS, type AssetType } from './types';

export type BundleFile = { path: string; content: string };
export type BundleWorkflow = {
  name: string;
  description: string;
  steps: Array<{ id: string; title: string; instruction: string }>;
};
export type Bundle = {
  schemaVersion: 1;
  files: BundleFile[];
  integrationId?: string;
  workflow?: BundleWorkflow;
};

/** Text only. Binary and executable formats (exe, dll, sh, bat, ps1, wasm, zip ...) are never accepted. */
const ALLOWED_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.svg', '.yml', '.yaml', '.sql', '.csv',
]);
const ALLOWED_DOTFILES = new Set(['.env.example', '.gitignore']);
const BLOCKED_SEGMENTS = new Set(['.git', '.next', 'node_modules', '.ssh', '.aws']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;

/** Returns an error message for an unsafe relative path, or null when it is safe. Applies to bundle paths and install folders. */
export function validateRelativePath(input: unknown, opts: { allowEmpty?: boolean; requireExtension?: boolean } = {}): string | null {
  if (typeof input !== 'string') return 'Path must be a string.';
  if (input === '') return opts.allowEmpty ? null : 'Path is empty.';
  if (input.length > LIMITS.maxPathLength) return 'Path is too long.';
  if (/[\u0000-\u001f\u007f]/.test(input)) return 'Path contains control characters.';
  if (input.includes('\\')) return 'Path must use forward slashes.';
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) return 'Path must be relative.';
  if (input.includes('//') || input.endsWith('/')) return 'Path has an empty segment.';
  const segments = input.split('/');
  if (segments.length > LIMITS.maxPathDepth) return 'Path is nested too deeply.';
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return 'Path traversal is not allowed.';
    if (!SEGMENT.test(segment)) return `Path segment "${segment.slice(0, 30)}" contains unsupported characters.`;
    if (/[. ]$/.test(segment)) return 'Path segments cannot end with a dot.';
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) return `Path segment "${segment}" is not allowed.`;
    if (WINDOWS_RESERVED.test(segment)) return `Path segment "${segment}" is a reserved name.`;
    if (/^\.env/i.test(segment) && !ALLOWED_DOTFILES.has(segment.toLowerCase())) return 'Environment files are not allowed.';
  }
  if (opts.requireExtension) {
    const name = segments[segments.length - 1];
    if (!ALLOWED_DOTFILES.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
      if (!ALLOWED_EXTENSIONS.has(ext)) return `File type "${ext || 'none'}" is not allowed.`;
    }
  }
  return null;
}

const workflowSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(500),
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
            title: z.string().min(1).max(100),
            instruction: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.maxWorkflowSteps),
  })
  .strict();

const bundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z.array(z.object({ path: z.string(), content: z.string() }).strict()).max(LIMITS.maxFiles),
    integrationId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).optional(),
    workflow: workflowSchema.optional(),
  })
  .strict();

export type BundleValidation =
  | { ok: true; bundle: Bundle; sizeBytes: number; fileCount: number; checksum: string }
  | { ok: false; errors: string[] };

/** Stable content hash: files are sorted by path and the key order is fixed, so equal content always hashes equal. */
export function checksumOf(bundle: Bundle) {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    files: [...bundle.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ path: f.path, content: f.content })),
    integrationId: bundle.integrationId ?? null,
    workflow: bundle.workflow ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Files that are written into a project: the bundle files plus generated descriptors for integration and workflow assets. */
export function installFilesOf(bundle: Bundle): BundleFile[] {
  const files = [...bundle.files];
  if (bundle.integrationId) {
    files.push({
      path: 'integration.json',
      content: `${JSON.stringify({ integrationId: bundle.integrationId, note: 'Connect credentials in the project Integrations page. This file holds no secrets.' }, null, 2)}\n`,
    });
  }
  if (bundle.workflow) {
    files.push({ path: 'workflow.json', content: `${JSON.stringify(bundle.workflow, null, 2)}\n` });
  }
  return files;
}

/**
 * Validates untrusted bundle JSON: schema, path safety, file types, size limits and per-type requirements.
 * `knownIntegrationIds` is injected so integration assets can only reference real catalogue entries.
 */
export function validateBundle(raw: unknown, type: AssetType, knownIntegrationIds: ReadonlySet<string>): BundleValidation {
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'bundle'}: ${i.message}`) };
  }
  const bundle = parsed.data as Bundle;
  const errors: string[] = [];

  const seen = new Set<string>();
  let total = 0;
  for (const file of bundle.files) {
    const pathError = validateRelativePath(file.path, { requireExtension: true });
    if (pathError) {
      errors.push(`${file.path.slice(0, 60)}: ${pathError}`);
      continue;
    }
    const key = file.path.toLowerCase();
    if (seen.has(key)) errors.push(`${file.path}: duplicate path.`);
    seen.add(key);
    if (file.content.includes('\u0000')) errors.push(`${file.path}: binary content is not allowed.`);
    const bytes = Buffer.byteLength(file.content);
    if (bytes > LIMITS.maxFileBytes) errors.push(`${file.path}: larger than ${LIMITS.maxFileBytes} bytes.`);
    total += bytes;
    if (/\.svg$/i.test(file.path) && /<script|\son[a-z]+\s*=|javascript:/i.test(file.content)) {
      errors.push(`${file.path}: SVG files cannot contain scripts or event handlers.`);
    }
  }
  const lowered = Array.from(seen);
  if (lowered.some((p) => lowered.some((q) => q.startsWith(`${p}/`)))) errors.push('A path is used as both a file and a folder.');
  if (bundle.files.some((f) => f.path === 'integration.json' || f.path === 'workflow.json')) {
    errors.push('integration.json and workflow.json are generated; remove them from files.');
  }

  if (type === 'INTEGRATION') {
    if (!bundle.integrationId) errors.push('Integration assets must set integrationId.');
    else if (!knownIntegrationIds.has(bundle.integrationId)) errors.push(`Unknown integration "${bundle.integrationId}".`);
  } else if (bundle.integrationId) {
    errors.push('integrationId is only valid for integration assets.');
  }
  if (type === 'WORKFLOW') {
    if (!bundle.workflow) errors.push('Workflow assets must include a workflow.');
  } else if (bundle.workflow) {
    errors.push('workflow is only valid for workflow assets.');
  }

  const fileCount = installFilesOf(bundle).length;
  if (fileCount === 0) errors.push('The bundle has no files.');
  if (total > LIMITS.maxBundleBytes) errors.push(`Bundle is larger than ${LIMITS.maxBundleBytes} bytes.`);

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 10) };
  return { ok: true, bundle, sizeBytes: total, fileCount, checksum: checksumOf(bundle) };
}
