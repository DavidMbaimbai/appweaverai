import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from './prisma';
import { provisionNewUser } from './auth/provision-user';

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
        },
      }
    : {}),
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
