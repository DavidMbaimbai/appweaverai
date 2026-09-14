'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getStripeClient, isStripeConfigured } from '@/lib/stripe';

type ActionResult = { success: true } | { error: string };

const refundPaymentSchema = z.object({
  chargeId: z.string().trim().min(1),
  reason: z.string().trim().min(1, 'A reason is required.'),
  amountCents: z.number().int().positive().optional(),
});

async function getRequestIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export async function refundPaymentAction(input: {
  chargeId: string;
  reason: string;
  amountCents?: number;
}): Promise<ActionResult> {
  const auth = await requireAdmin('payments:refund');
  if (!auth.ok) return { error: 'Not authorized.' };

  const parsed = refundPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid refund request.' };
  }

  if (!isStripeConfigured()) {
    return { error: 'Stripe is not configured.' };
  }

  const ipAddress = await getRequestIp();

  try {
    const stripe = getStripeClient();
    const charge = await stripe.charges.retrieve(parsed.data.chargeId);
    const refundableAmount = Math.max(
      charge.amount - charge.amount_refunded,
      0,
    );

    if (refundableAmount <= 0) {
      return { error: 'This payment has no refundable balance remaining.' };
    }

    if (
      parsed.data.amountCents !== undefined &&
      parsed.data.amountCents > refundableAmount
    ) {
      return { error: 'Refund amount exceeds the remaining refundable balance.' };
    }

    const refund = await stripe.refunds.create({
      charge: charge.id,
      amount:
        parsed.data.amountCents !== undefined &&
        parsed.data.amountCents < refundableAmount
          ? parsed.data.amountCents
          : undefined,
      reason: 'requested_by_customer',
    });

    const updatedCharge = await stripe.charges.retrieve(charge.id);

    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'payment.refund',
      targetType: 'StripeCharge',
      targetId: charge.id,
      before: {
        amount: charge.amount,
        amountRefunded: charge.amount_refunded,
        refundableAmount,
        currency: charge.currency.toUpperCase(),
      },
      after: {
        refundId: refund.id,
        refundAmount: refund.amount,
        amountRefunded: updatedCharge.amount_refunded,
        refundableAmount: Math.max(
          updatedCharge.amount - updatedCharge.amount_refunded,
          0,
        ),
        currency: updatedCharge.currency.toUpperCase(),
      },
      reason: parsed.data.reason,
      ipAddress,
    });

    revalidatePath('/admin/payments');
    revalidatePath(`/admin/payments/${charge.id}`);
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create refund.';

    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'payment.refund',
      targetType: 'StripeCharge',
      targetId: parsed.data.chargeId,
      before: {
        amountCents: parsed.data.amountCents ?? null,
      },
      after: { error: message },
      result: 'FAILURE',
      reason: parsed.data.reason,
      ipAddress,
    });

    return { error: message };
  }
}
