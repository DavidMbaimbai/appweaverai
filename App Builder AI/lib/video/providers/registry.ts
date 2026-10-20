import { createNovaReelProvider } from './nova-reel';
import type { VideoProvider } from './types';

/**
 * Registered video providers.
 *
 * To add a provider:
 *  1. Implement `VideoProvider` (see ./types.ts and ./nova-reel.ts) in a new file.
 *  2. Add its factory to `PROVIDER_FACTORIES` below.
 *  3. Done: auto-selection (lib/video/select.ts), the admin page and the
 *     cron poller all work from this registry. Admins enable it per provider
 *     in /admin/video; nothing is available until enabled and configured.
 */
const PROVIDER_FACTORIES: Array<() => VideoProvider> = [() => createNovaReelProvider()];

const providers = new Map<string, VideoProvider>();

function ensureLoaded() {
  if (providers.size > 0) return;
  for (const factory of PROVIDER_FACTORIES) {
    const provider = factory();
    providers.set(provider.id, provider);
  }
}

export function listVideoProviders(): VideoProvider[] {
  ensureLoaded();
  return Array.from(providers.values());
}

export function getVideoProvider(id: string): VideoProvider | undefined {
  ensureLoaded();
  return providers.get(id);
}

/** Registers (or replaces) a provider at runtime; used by tests and plugins. */
export function registerVideoProvider(provider: VideoProvider) {
  ensureLoaded();
  providers.set(provider.id, provider);
}

export function unregisterVideoProvider(id: string) {
  ensureLoaded();
  providers.delete(id);
}
