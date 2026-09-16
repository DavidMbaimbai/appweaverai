import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';
import { prisma } from './prisma';
import { provisionNewUser } from './auth/provision-user';
import { recordAuthActivity } from './auth/record-auth-activity';
import { sendEmail } from './email';
import { renderBrandedEmail, highlightCodeHtml } from './email-templates';
import { accountLinkingConfig, getSocialProviders } from './auth/oauth-config';

const useDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Best-effort client IP extraction directly from request headers, used as a
 * fallback for our own auth-activity logging (Admin Console Audit Logs /
 * Security Events geo lookup). better-auth's own `session.ipAddress` refuses
 * to resolve an IP from `x-forwarded-for` whenever the header carries more
 * than one hop and no `trustedProxies` is configured (common behind a CDN /
 * reverse proxy), leaving it as an empty string. That refusal is the right
 * call for security-sensitive decisions (rate limiting), but for a purely
 * informational "where did this login come from" display we can safely take
 * the left-most (originating client) address instead.
 */
function getClientIpFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
): string | null {
  if (!headers) return null;

  const read = (key: string): string | null => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(key);
    }
    const value = (headers as Record<string, string | string[] | undefined>)[
      key
    ];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };

  const forwardedFor = read('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  return read('x-real-ip') ?? read('cf-connecting-ip') ?? null;
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  ...(useDatabase
    ? {
        database: prismaAdapter(prisma, {
          provider: 'postgresql',
        }),
      }
    : {}),
  socialProviders: getSocialProviders(process.env),

  account: {
    accountLinking: accountLinkingConfig,
  },

  /**
   * Email + password is used both by the public sign-up/sign-in modal (see
   * components/auth/auth-modal.tsx) and the dedicated Admin Console sign-in
   * page (app/admin/login). Admin accounts are still provisioned directly
   * (see lib/admin/bootstrap-seed-admin.ts) rather than through this sign-up
   * flow, but regular customers can now create an account with an email +
   * password in addition to Google/GitHub.
   */
  emailAndPassword: {
    enabled: true,
  },

  user: {
    additionalFields: {
      username: {
        type: 'string',
        required: false,
      },
    },
  },

  ...(useDatabase
    ? {
        databaseHooks: {
          user: {
            create: {
              after: async (user) => {
                await provisionNewUser({
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  username:
                    typeof user.username === 'string' ? user.username : null,
                });
              },
            },
          },
          session: {
            create: {
              // Fires for every new session (sign-up's auto sign-in, plain
              // sign-in, and OAuth callbacks alike) — used to surface real
              // user activity in the Admin Console's Audit Logs / Security
              // Events, which previously only tracked privileged admin
              // actions.
              after: async (session, context) => {
                const path = context?.path ?? '';
                const event = path.includes('sign-up') ? 'signup' : 'login';
                const headerIp = getClientIpFromHeaders(
                  context?.headers ?? context?.request?.headers,
                );

                await recordAuthActivity({
                  userId: session.userId,
                  event,
                  // Prefer the header-derived left-most client IP (same
                  // resolution used for logout, which already works
                  // correctly) over better-auth's own session.ipAddress,
                  // which behind a reverse proxy / CDN is often the proxy's
                  // own address (or empty) rather than the real client IP.
                  ipAddress: headerIp || session.ipAddress || null,
                });
              },
            },
            delete: {
              // Fires whenever a session row is removed — the main path
              // being an explicit sign-out (see components/auth/auth-nav-actions.tsx,
              // account-menu.tsx, admin-sign-out-button.tsx). Surfaces
              // logouts in the Admin Console's Audit Logs / Security Events
              // and analytics, which previously only tracked logins.
              after: async (session, context) => {
                const headerIp = getClientIpFromHeaders(
                  context?.headers ?? context?.request?.headers,
                );

                await recordAuthActivity({
                  userId: session.userId,
                  event: 'logout',
                  ipAddress: headerIp ?? null,
                });
              },
            },
          },
        },
      }
    : {}),
  plugins: [
    emailOTP({
      otpLength: 8,
      expiresIn: 600, // 10 minutes
      // New sign-ups get an 8-digit code emailed to them, which they enter
      // to verify their address (see components/auth/auth-modal.tsx).
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type === 'forget-password') {
          await sendEmail({
            to: email,
            subject: `${otp} is your AppWeaver AI password reset code`,
            html: renderBrandedEmail({
              previewText: `Your AppWeaver AI password reset code is ${otp}`,
              heading: 'Reset your password',
              bodyHtml: `
                <p style="margin:0 0 4px;">Enter this code to choose a new password for your AppWeaver AI account:</p>
                ${highlightCodeHtml(otp)}
                <p style="margin:12px 0 0;color:#696c74;font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email — your password won't change.</p>
              `,
            }),
            text: `Your AppWeaver AI password reset code is ${otp}. It expires in 10 minutes.`,
          });
          return;
        }

        if (type !== 'email-verification') return;

        await sendEmail({
          to: email,
          subject: `${otp} is your AppWeaver AI verification code`,
          html: renderBrandedEmail({
            previewText: `Your AppWeaver AI verification code is ${otp}`,
            heading: 'Verify your email',
            bodyHtml: `
              <p style="margin:0 0 4px;">Enter this code to finish signing in to AppWeaver AI:</p>
              ${highlightCodeHtml(otp)}
              <p style="margin:12px 0 0;color:#696c74;font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
            `,
          }),
          text: `Your AppWeaver AI verification code is ${otp}. It expires in 10 minutes.`,
        });
      },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
