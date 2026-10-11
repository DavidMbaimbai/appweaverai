import { prisma } from '../prisma';
import { getAppTier, getDailyDesignSuggestionLimit } from '../billing/entitlements';
import { getUserBillingFields } from '../queries/billing';

/**
 * Daily cap for lightweight AI helpers (design suggestions, content
 * assistant), counted from AiUsageEvent rows for the given model.
 * Returns an error message when the user is over the cap, otherwise null.
 */
export async function checkDailyAiLimit(
  userId: string,
  model: string,
): Promise<string | null> {
  const tier = getAppTier(await getUserBillingFields(userId));
  const dailyLimit = getDailyDesignSuggestionLimit(tier);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const usedToday = await prisma.aiUsageEvent.count({
    where: { userId, model, createdAt: { gte: startOfDay } },
  });
  if (usedToday < dailyLimit) return null;

  return tier === 'pro'
    ? 'Daily AI helper limit reached. Try again tomorrow.'
    : `Free plan is limited to ${dailyLimit} AI helper requests per day. Upgrade to Pro for more.`;
}
