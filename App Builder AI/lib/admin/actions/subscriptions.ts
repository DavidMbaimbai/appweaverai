'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { recordAuditLog } from '@/lib/admin/audit';
import { syncUserSubscription } from '@/lib/billing/stripe-subscription';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';
import {
  getStripeClient,
  isStripeConfigured,
  resolveStripeProPriceId,
} from '@/lib/stripe';

type ActionResult = { success: true } | { error: string };

const changePlanSchema = z.object({
  userId: z.string().trim().min(1),
  newPlan: z.enum(['free', 'pro']),
  reason: z.string().trim().min(1, 'A reason is required.'),
});

const extendTrialSchema = z.object({
  userId: z.string().trim().min(1),
  newTrialEnd: z.string().trim().min(1, 'A new date is required.'),
  reason: z.string().trim().min(1, 'A reason is required.'),
});

async function getRequestIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

function getCustomerId(customer: string | { id: string } | null) {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

async function getManagedUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
    },
  });
}

function revalidateSubscriptionPaths(userId: string) {
  revalidatePath('/admin/subscriptions');
  revalidatePath(`/admin/subscriptions/${userId}`);
  revalidatePath(`/admin/users/${userId}`);
}

export async function changeSubscriptionPlanAction(input: {
  userId: string;
  newPlan: 'free' | 'pro';
  reason: string;
}): Promise<ActionResult> {
  const auth = await requireAdmin('subscriptions:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid subscription update.',
    };
  }

  const user = await getManagedUser(parsed.data.userId);
  if (!user) return { error: 'User not found.' };
  if (user.subscriptionPlan === parsed.data.newPlan) {
    return { error: 'The user is already on that plan.' };
  }

  const ipAddress = await getRequestIp();
  const before = {
    subscriptionPlan: user.subscriptionPlan,
    subscriptionStatus: user.subscriptionStatus,
    stripeSubscriptionId: user.stripeSubscriptionId,
  };

  try {
    if (user.stripeSubscriptionId) {
      if (!isStripeConfigured()) {
        return { error: 'Stripe is not configured.' };
      }

      const stripe = getStripeClient();
      const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
        { expand: ['items.data'] },
      );

      if (parsed.data.newPlan === 'pro') {
        const existingItem = subscription.items.data[0];
        if (!existingItem) {
          return { error: 'This subscription has no billable items to update.' };
        }

        const updatedSubscription = await stripe.subscriptions.update(
          subscription.id,
          {
            items: [
              {
                id: existingItem.id,
                price: await resolveStripeProPriceId(),
              },
            ],
            proration_behavior: 'create_prorations',
          },
        );

        await syncUserSubscription(
          user.id,
          updatedSubscription,
          getCustomerId(subscription.customer),
        );

        const updatedUser = await getManagedUser(user.id);
        await recordAuditLog({
          adminId: auth.admin.id,
          adminEmail: auth.admin.email,
          action: 'subscription.change_plan',
          targetType: 'User',
          targetId: user.id,
          before,
          after: {
            subscriptionPlan: updatedUser?.subscriptionPlan ?? 'pro',
            subscriptionStatus:
              updatedUser?.subscriptionStatus ?? updatedSubscription.status,
            stripeSubscriptionId:
              updatedUser?.stripeSubscriptionId ?? updatedSubscription.id,
          },
          reason: parsed.data.reason,
          ipAddress,
        });
      } else {
        await stripe.subscriptions.cancel(subscription.id);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            stripeSubscriptionId: null,
            subscriptionPlan: 'free',
            subscriptionStatus: 'canceled',
          },
        });

        await recordAuditLog({
          adminId: auth.admin.id,
          adminEmail: auth.admin.email,
          action: 'subscription.change_plan',
          targetType: 'User',
          targetId: user.id,
          before,
          after: {
            subscriptionPlan: 'free',
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
          },
          reason: parsed.data.reason,
          ipAddress,
        });
      }
    } else {
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionPlan: parsed.data.newPlan,
          subscriptionStatus:
            parsed.data.newPlan === 'pro' ? 'active' : null,
        },
        select: {
          subscriptionPlan: true,
          subscriptionStatus: true,
          stripeSubscriptionId: true,
        },
      });

      await recordAuditLog({
        adminId: auth.admin.id,
        adminEmail: auth.admin.email,
        action: 'subscription.change_plan',
        targetType: 'User',
        targetId: user.id,
        before,
        after: updatedUser,
        reason: parsed.data.reason,
        ipAddress,
      });
    }

    revalidateSubscriptionPaths(user.id);
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to change plan.';

    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'subscription.change_plan',
      targetType: 'User',
      targetId: user.id,
      before,
      after: {
        requestedPlan: parsed.data.newPlan,
        error: message,
      },
      result: 'FAILURE',
      reason: parsed.data.reason,
      ipAddress,
    });

    return { error: message };
  }
}

export async function extendSubscriptionTrialAction(input: {
  userId: string;
  newTrialEnd: string;
  reason: string;
}): Promise<ActionResult> {
  const auth = await requireAdmin('subscriptions:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const parsed = extendTrialSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid trial extension.',
    };
  }

  const user = await getManagedUser(parsed.data.userId);
  if (!user) return { error: 'User not found.' };
  if (!user.stripeSubscriptionId) {
    return { error: 'This user does not have a Stripe subscription to extend.' };
  }
  if (!isStripeConfigured()) {
    return { error: 'Stripe is not configured.' };
  }

  const newTrialEnd = new Date(parsed.data.newTrialEnd);
  if (Number.isNaN(newTrialEnd.getTime())) {
    return { error: 'Enter a valid future date.' };
  }

  const nextTrialEndUnix = Math.floor(newTrialEnd.getTime() / 1000);
  if (nextTrialEndUnix <= Math.floor(Date.now() / 1000)) {
    return { error: 'The new trial end must be in the future.' };
  }

  const ipAddress = await getRequestIp();

  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId,
    );

    // Stripe exposes trial_end updates, but current_period_end is read-only.
    // For MVP we only support extending active trials, not paid billing periods.
    if (subscription.status !== 'trialing' || !subscription.trial_end) {
      return {
        error:
          'Only active trials can be extended. Extending a paid billing period is not supported by Stripe through this action.',
      };
    }

    if (nextTrialEndUnix <= subscription.trial_end) {
      return {
        error: 'The new trial end must be later than the current trial end.',
      };
    }

    const updatedSubscription = await stripe.subscriptions.update(
      subscription.id,
      { trial_end: nextTrialEndUnix },
    );

    await syncUserSubscription(
      user.id,
      updatedSubscription,
      getCustomerId(subscription.customer),
    );

    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'subscription.extend_trial',
      targetType: 'User',
      targetId: user.id,
      before: {
        subscriptionId: subscription.id,
        trialEnd: new Date(subscription.trial_end * 1000),
      },
      after: {
        subscriptionId: updatedSubscription.id,
        trialEnd: updatedSubscription.trial_end
          ? new Date(updatedSubscription.trial_end * 1000)
          : null,
      },
      reason: parsed.data.reason,
      ipAddress,
    });

    revalidateSubscriptionPaths(user.id);
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to extend trial.';

    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'subscription.extend_trial',
      targetType: 'User',
      targetId: user.id,
      before: {
        requestedTrialEnd: parsed.data.newTrialEnd,
      },
      after: { error: message },
      result: 'FAILURE',
      reason: parsed.data.reason,
      ipAddress,
    });

    return { error: message };
  }
}
