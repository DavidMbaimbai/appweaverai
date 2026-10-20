import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import { type AgentScope } from '@/lib/agents/types';

import type { MessageChannelName } from './types';
import { PROJECT_CONNECTION_FIELDS_VIEW } from './connection-fields';

type Env = Record<string, string | undefined>;

export type WhatsAppCredentials = { accessToken: string; phoneNumberId: string; approvedTemplates: string[] };
export type SmsCredentials = { accountSid: string; authToken: string; from: string };
export type MetaPageCredentials = { accountId: string; accessToken: string };
export type ChannelCredentials = WhatsAppCredentials | SmsCredentials | MetaPageCredentials;

/** Fields a project owner fills in to connect their own account (stored encrypted). */
export const PROJECT_CONNECTION_FIELDS = PROJECT_CONNECTION_FIELDS_VIEW;

/** Env names a channel needs on the platform scope (and, for webhooks, on every scope). */
const PLATFORM_ENV: Record<MessageChannelName, { required: string[]; anyOf?: string[][]; note?: string }> = {
  WEBCHAT: { required: [], note: 'Web chat is for projects only (embed the widget on a published project).' },
  EMAIL: {
    required: ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'],
    note: 'Uses the existing support mailbox.',
  },
  WHATSAPP: { required: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET'] },
  SMS: { required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_INBOX_NUMBER'] },
  FACEBOOK: { required: ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'] },
  INSTAGRAM: { required: ['INSTAGRAM_USER_ID', 'INSTAGRAM_ACCESS_TOKEN', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'] },
};

/** Shared platform env needed by webhooks even when a project brings its own credentials. */
const PROJECT_SHARED_ENV: Partial<Record<MessageChannelName, string[]>> = {
  WHATSAPP: ['WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET'],
  FACEBOOK: ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'],
  INSTAGRAM: ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'],
};

export type ChannelStatus = {
  channel: MessageChannelName;
  configured: boolean;
  /** Exact env var names (or connection fields) that are missing. */
  missing: string[];
  note?: string;
};

const has = (env: Env, name: string) => Boolean(env[name]?.trim());

/** Pure status check; never reports "configured" unless every required value is present. */
export function computeChannelStatus(
  channel: MessageChannelName,
  scope: AgentScope['type'],
  env: Env,
  connection: Record<string, string> | null,
): ChannelStatus {
  if (scope === 'PLATFORM') {
    const spec = PLATFORM_ENV[channel];
    if (channel === 'WEBCHAT') return { channel, configured: false, missing: [], note: spec.note };
    const missing = spec.required.filter((name) => !has(env, name));
    return { channel, configured: missing.length === 0, missing, note: spec.note };
  }

  if (channel === 'WEBCHAT') return { channel, configured: true, missing: [], note: 'Embed the widget script on your published site.' };
  if (channel === 'EMAIL') {
    return {
      channel,
      configured: false,
      missing: [],
      note: 'Inbound email for projects is not built yet; the support mailbox serves AppWeaver only.',
    };
  }
  const fields = PROJECT_CONNECTION_FIELDS[channel] ?? [];
  const required = fields.filter((f) => f.key !== 'approvedTemplates');
  const missing = [
    ...required.filter((f) => !connection?.[f.key]?.trim()).map((f) => `connection: ${f.key}`),
    ...(PROJECT_SHARED_ENV[channel] ?? []).filter((name) => !has(env, name)),
  ];
  return { channel, configured: missing.length === 0, missing };
}

export async function getProjectConnectionFields(projectId: string, channel: MessageChannelName) {
  const row = await prisma.channelConnection.findUnique({
    where: { scopeType_scopeId_channel: { scopeType: 'PROJECT', scopeId: projectId, channel } },
  });
  if (!row || row.status !== 'ACTIVE') return null;
  try {
    return JSON.parse(decryptSecret(row.config)) as Record<string, string>;
  } catch {
    return null;
  }
}

export async function channelStatuses(scope: AgentScope): Promise<ChannelStatus[]> {
  const channels: MessageChannelName[] = ['WEBCHAT', 'EMAIL', 'WHATSAPP', 'SMS', 'FACEBOOK', 'INSTAGRAM'];
  return Promise.all(
    channels.map(async (channel) => {
      const connection =
        scope.type === 'PROJECT' ? await getProjectConnectionFields(scope.projectId, channel).catch(() => null) : null;
      return computeChannelStatus(channel, scope.type, process.env, connection);
    }),
  );
}

/** Saves (encrypted) credentials for a project channel and indexes the non-secret account id for webhook routing. */
export async function saveProjectConnection(projectId: string, channel: MessageChannelName, fields: Record<string, string>) {
  const spec = PROJECT_CONNECTION_FIELDS[channel];
  if (!spec) throw new Error('This channel cannot be connected per project.');
  const clean: Record<string, string> = {};
  for (const f of spec) {
    const value = fields[f.key]?.trim();
    if (value) clean[f.key] = value.slice(0, 2000);
  }
  const accountId = clean.phoneNumberId ?? clean.pageId ?? clean.from ?? null;
  const config = encryptSecret(JSON.stringify(clean));
  await prisma.channelConnection.upsert({
    where: { scopeType_scopeId_channel: { scopeType: 'PROJECT', scopeId: projectId, channel } },
    create: { scopeType: 'PROJECT', scopeId: projectId, channel, accountId, config, status: 'ACTIVE' },
    update: { accountId, config, status: 'ACTIVE' },
  });
}

export async function removeProjectConnection(projectId: string, channel: MessageChannelName) {
  await prisma.channelConnection.deleteMany({ where: { scopeType: 'PROJECT', scopeId: projectId, channel } });
}

/** Credentials to send on a channel for a scope: project connection, or platform env. Null when not configured. */
export async function getCredentials(scope: AgentScope, channel: MessageChannelName): Promise<ChannelCredentials | null> {
  const env = process.env;
  if (scope.type === 'PLATFORM') {
    switch (channel) {
      case 'WHATSAPP':
        return has(env, 'WHATSAPP_ACCESS_TOKEN') && has(env, 'WHATSAPP_PHONE_NUMBER_ID')
          ? {
              accessToken: env.WHATSAPP_ACCESS_TOKEN!.trim(),
              phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!.trim(),
              approvedTemplates: splitList(env.WHATSAPP_APPROVED_TEMPLATES),
            }
          : null;
      case 'SMS':
        return has(env, 'TWILIO_ACCOUNT_SID') && has(env, 'TWILIO_AUTH_TOKEN') && has(env, 'TWILIO_INBOX_NUMBER')
          ? { accountSid: env.TWILIO_ACCOUNT_SID!.trim(), authToken: env.TWILIO_AUTH_TOKEN!.trim(), from: env.TWILIO_INBOX_NUMBER!.trim() }
          : null;
      case 'FACEBOOK':
        return has(env, 'FACEBOOK_PAGE_ID') && has(env, 'FACEBOOK_PAGE_ACCESS_TOKEN')
          ? { accountId: env.FACEBOOK_PAGE_ID!.trim(), accessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN!.trim() }
          : null;
      case 'INSTAGRAM':
        return has(env, 'INSTAGRAM_USER_ID') && has(env, 'INSTAGRAM_ACCESS_TOKEN')
          ? { accountId: env.INSTAGRAM_USER_ID!.trim(), accessToken: env.INSTAGRAM_ACCESS_TOKEN!.trim() }
          : null;
      default:
        return null;
    }
  }

  const f = await getProjectConnectionFields(scope.projectId, channel);
  if (!f) return null;
  switch (channel) {
    case 'WHATSAPP':
      return f.accessToken && f.phoneNumberId
        ? { accessToken: f.accessToken, phoneNumberId: f.phoneNumberId, approvedTemplates: splitList(f.approvedTemplates) }
        : null;
    case 'SMS':
      return f.accountSid && f.authToken && f.from ? { accountSid: f.accountSid, authToken: f.authToken, from: f.from } : null;
    case 'FACEBOOK':
    case 'INSTAGRAM':
      return f.pageId && f.accessToken ? { accountId: f.pageId, accessToken: f.accessToken } : null;
    default:
      return null;
  }
}

function splitList(value: string | undefined) {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Finds which scope owns a provider account (phone number id, page id, Twilio number) for inbound webhooks.
 * Project connections win; the platform env account maps to the PLATFORM scope. Null = unknown account (drop).
 */
export async function resolveScopeForAccount(channel: MessageChannelName, accountId: string | undefined): Promise<AgentScope | null> {
  if (!accountId) return null;
  const row = await prisma.channelConnection.findFirst({
    where: { channel, accountId, status: 'ACTIVE', scopeType: 'PROJECT' },
    select: { scopeId: true },
  });
  if (row) return { type: 'PROJECT', projectId: row.scopeId };

  const env = process.env;
  const platformAccount =
    channel === 'WHATSAPP'
      ? env.WHATSAPP_PHONE_NUMBER_ID
      : channel === 'SMS'
        ? env.TWILIO_INBOX_NUMBER
        : channel === 'FACEBOOK'
          ? env.FACEBOOK_PAGE_ID
          : channel === 'INSTAGRAM'
            ? env.INSTAGRAM_USER_ID
            : undefined;
  return platformAccount?.trim() && platformAccount.trim() === accountId ? { type: 'PLATFORM' } : null;
}
