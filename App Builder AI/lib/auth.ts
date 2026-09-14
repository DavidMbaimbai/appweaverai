import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';
import { prisma } from './prisma';
import { provisionNewUser } from './auth/provision-user';
import { recordAuthActivity } from './auth/record-auth-activity';
import { sendEmail } from './email';
import { renderBrandedEmail, highlightCodeHtml } from './email-templates';

const useDatabase = Boolean(process.env.DATABASE_URL);

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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    },
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

                await recordAuthActivity({
                  userId: session.userId,
                  event,
                  ipAddress: session.ipAddress ?? null,
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
