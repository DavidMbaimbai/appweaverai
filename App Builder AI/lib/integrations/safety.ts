/** Env var prefixes that bundlers expose to browser code. Secrets must never use them. */
export const CLIENT_EXPOSED_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'PUBLIC_', 'EXPO_PUBLIC_', 'NUXT_PUBLIC_'] as const;

export function clientExposedPrefix(name: string): string | null {
  const upper = name.toUpperCase();
  return CLIENT_EXPOSED_PREFIXES.find((p) => upper.startsWith(p)) ?? null;
}

/** Warning shown when a user tries to save a secret under a browser-exposed name. */
export function publicSecretWarning(name: string): string | null {
  const prefix = clientExposedPrefix(name);
  return prefix
    ? `${name} starts with ${prefix}, so build tools would ship its value to every visitor's browser. Use a name without that prefix and read it only on the server.`
    : null;
}
