export const INTEGRATION_CATEGORIES = [
  'Databases',
  'APIs',
  'Payments',
  'Email',
  'CRM',
  'Analytics',
  'AI models',
  'Media generation',
  'Communication',
  'Dev tools',
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export type AuthType = 'api_key' | 'oauth' | 'webhook' | 'connection_string' | 'none';

/** `available` = connect + test are implemented. `coming_soon` = listed only; it cannot be connected. */
export type IntegrationStatus = 'available' | 'coming_soon';

export type CredentialField = {
  key: string;
  label: string;
  /** Secret fields are encrypted, masked after save and injected as server-side env vars. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Rendered as a dropdown; also the only accepted values. */
  options?: readonly string[];
  /** Validation applied on connect. */
  pattern?: RegExp;
  patternMessage?: string;
  maxLength?: number;
  /** Server-side env var the value is injected as. Never starts with a client-exposed prefix. */
  envVar?: string;
};

export type TestResult = { ok: boolean; message: string };

export type HttpFn = typeof fetch;

export type TestContext = {
  /** Plain fetch for fixed first-party vendor hosts. */
  fetch: HttpFn;
  /** SSRF-guarded fetch for user-supplied hosts. */
  safeFetch: HttpFn;
};

export type SetupTemplate = {
  /** Server-side code only: route handlers, server actions, edge functions. */
  snippet: string;
  note?: string;
};

export type IntegrationDefinition = {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  status: IntegrationStatus;
  authType: AuthType;
  /** Short mark and brand colour for the card; no third-party logos are bundled. */
  mark: string;
  color: string;
  fields: readonly CredentialField[];
  /** Permissions or scopes the credential needs. Shown before connecting. */
  scopes: readonly string[];
  docsUrl: string;
  costNote: string;
  /** Risks the user must read before connecting (e.g. network exposure of a database). */
  warnings?: readonly string[];
  /** Platform-managed integrations (webhooks) have no credential form; they open a panel instead. */
  platformFeature?: 'webhooks_inbound' | 'webhooks_outbound';
  /** Real read-only call proving the credentials work. Present on every `available` credentialed entry. */
  test?: (credentials: Record<string, string>, ctx: TestContext) => Promise<TestResult>;
  /** The entry calls a user-defined URL, so it is SSRF-guarded and can be proxied. */
  userDefinedUrl?: boolean;
  /** Env var that receives the project's proxy URL for this connector. */
  proxyUrlEnvVar?: string;
  /** Cross-field validation after per-field checks. Return an error message or null. */
  validate?: (values: Record<string, string>) => string | null;
  setup?: SetupTemplate;
};

export type PublicField = Omit<CredentialField, 'pattern'>;

/** JSON-safe catalogue entry sent to the browser (no functions, no regexes). */
export type PublicIntegration = Omit<IntegrationDefinition, 'test' | 'fields'> & {
  fields: readonly PublicField[];
  disabled: boolean;
  disabledReason: string | null;
};
