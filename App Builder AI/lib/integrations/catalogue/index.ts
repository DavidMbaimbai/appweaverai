import { COMING_SOON_INTEGRATIONS } from './coming-soon';
import { AVAILABLE_INTEGRATIONS } from './providers';
import type { IntegrationDefinition, PublicField, PublicIntegration } from './types';

import { CLIENT_EXPOSED_PREFIXES, clientExposedPrefix, publicSecretWarning } from '../safety';

export * from './types';

/** Mirrors MANAGED_ENV_KEYS in lib/projects/env-vars.ts (not imported to keep the catalogue free of DB code). */
const MANAGED_ENV_KEYS: ReadonlySet<string> = new Set(['DATABASE_URL']);

export const INTEGRATIONS: readonly IntegrationDefinition[] = [...AVAILABLE_INTEGRATIONS, ...COMING_SOON_INTEGRATIONS];

const BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return BY_ID.get(id);
}

export { CLIENT_EXPOSED_PREFIXES, clientExposedPrefix, publicSecretWarning };

export function envVarsFor(def: IntegrationDefinition): string[] {
  return def.fields.map((f) => f.envVar).filter((v): v is string => Boolean(v));
}

/** Structural checks run by tests (and cheaply at startup in dev). Returns human-readable problems. */
export function validateCatalogue(entries: readonly IntegrationDefinition[] = INTEGRATIONS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const envNames = new Map<string, string>();
  for (const def of entries) {
    const at = `[${def.id}]`;
    if (!/^[a-z0-9-]+$/.test(def.id)) problems.push(`${at} id must be kebab-case`);
    if (ids.has(def.id)) problems.push(`${at} duplicate id`);
    ids.add(def.id);
    if (!def.docsUrl.startsWith('https://')) problems.push(`${at} docsUrl must be https`);
    if (!def.description || !def.costNote) problems.push(`${at} needs description and costNote`);

    if (def.status === 'coming_soon') {
      if (def.test || def.fields.length) problems.push(`${at} coming_soon entries must not define fields or tests`);
      continue;
    }
    if (def.scopes.length === 0) problems.push(`${at} must list scopes`);
    if (!def.platformFeature) {
      if (!def.test) problems.push(`${at} is available but has no test function`);
      if (def.fields.length === 0) problems.push(`${at} is available but has no credential fields`);
      if (!def.setup?.snippet) problems.push(`${at} is available but has no setup template`);
      if (!def.fields.some((f) => f.secret)) problems.push(`${at} has no secret field`);
    }
    const keys = new Set<string>();
    for (const field of def.fields) {
      if (keys.has(field.key)) problems.push(`${at} duplicate field ${field.key}`);
      keys.add(field.key);
      if (field.envVar) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(field.envVar)) problems.push(`${at} bad env var ${field.envVar}`);
        if (clientExposedPrefix(field.envVar)) problems.push(`${at} env var ${field.envVar} is browser-exposed`);
        if (MANAGED_ENV_KEYS.has(field.envVar)) problems.push(`${at} env var ${field.envVar} is platform-managed`);
        const owner = envNames.get(field.envVar);
        if (owner && owner !== def.id) problems.push(`${at} env var ${field.envVar} also used by ${owner}`);
        envNames.set(field.envVar, def.id);
      }
      if (field.secret && !field.envVar && def.id !== 'rest-api' && def.id !== 'graphql-api') {
        problems.push(`${at} secret ${field.key} needs an envVar`);
      }
    }
    if (def.setup?.snippet && /NEXT_PUBLIC_/.test(def.setup.snippet)) problems.push(`${at} snippet uses NEXT_PUBLIC_`);
  }
  return problems;
}

function toPublicField(field: PublicField & { pattern?: RegExp }): PublicField {
  const { pattern: _pattern, ...rest } = field;
  void _pattern;
  return rest;
}

export function toPublicIntegration(
  def: IntegrationDefinition,
  override?: { disabled: boolean; reason: string | null } | null,
): PublicIntegration {
  const { test: _test, validate: _validate, fields, ...rest } = def;
  void _test;
  void _validate;
  return {
    ...rest,
    fields: fields.map(toPublicField),
    disabled: override?.disabled ?? false,
    disabledReason: override?.disabled ? (override.reason ?? null) : null,
  };
}

/** Validates submitted values against the catalogue definition. Returns field errors and cleaned values. */
export function validateCredentials(
  def: IntegrationDefinition,
  input: Record<string, unknown>,
): { ok: true; values: Record<string, string> } | { ok: false; error: string; field?: string } {
  const values: Record<string, string> = {};
  for (const field of def.fields) {
    const raw = input[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      if (field.required) return { ok: false, error: `${field.label} is required.`, field: field.key };
      continue;
    }
    if (value.length > (field.maxLength ?? 512)) return { ok: false, error: `${field.label} is too long.`, field: field.key };
    if (/[\r\n\0]/.test(value)) return { ok: false, error: `${field.label} contains invalid characters.`, field: field.key };
    if (field.options && !field.options.includes(value)) return { ok: false, error: `${field.label} has an invalid choice.`, field: field.key };
    if (field.pattern && !field.pattern.test(value)) {
      return { ok: false, error: field.patternMessage ?? `${field.label} looks invalid.`, field: field.key };
    }
    values[field.key] = value;
  }
  const crossError = def.validate?.(values);
  if (crossError) return { ok: false, error: crossError };
  return { ok: true, values };
}

export function maskLast4(value: string): string {
  return value.length >= 8 ? `••••${value.slice(-4)}` : '••••';
}
