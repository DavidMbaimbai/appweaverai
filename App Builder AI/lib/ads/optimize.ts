export type AdStats = {
  id: string;
  spendCents: number;
  clicks: number;
  signups: number;
};

export const MAX_ACTIVE_ADS = 3;
/** An ad is judged only after it has spent this much (cents). */
export const JUDGE_AFTER_SPEND_CENTS = 300;

const score = (ad: AdStats) => ad.signups * 1000 + ad.clicks;

/**
 * Picks ads to pause: judged ads with no sign-ups, then the weakest ads when
 * more than MAX_ACTIVE_ADS are running. The best ad is never paused, so
 * the campaign always keeps something running.
 */
export function adsToPause(active: AdStats[]): string[] {
  if (active.length <= 1) return [];
  const ranked = [...active].sort((a, b) => score(b) - score(a));
  const best = ranked[0];
  const pause = new Set<string>();

  for (const ad of ranked.slice(1)) {
    if (ad.spendCents >= JUDGE_AFTER_SPEND_CENTS && ad.signups === 0) pause.add(ad.id);
  }

  const remaining = ranked.filter((ad) => !pause.has(ad.id));
  for (const ad of remaining.slice(MAX_ACTIVE_ADS).reverse()) {
    if (ad.id !== best.id) pause.add(ad.id);
  }
  return [...pause];
}
