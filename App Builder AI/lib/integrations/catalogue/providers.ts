import { buildAuthHeaders, parseConnectorConfig } from '../connector';
import { testPostgresConnection } from '../postgres';
import { validateOutboundUrl } from '../ssrf';
import { bearer, probe } from './probe';
import type { IntegrationDefinition } from './types';

const SERVER_NOTE = 'Server-side only: use these from route handlers or server actions, never in browser code.';

export const AVAILABLE_INTEGRATIONS: readonly IntegrationDefinition[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'Payments',
    description: 'Accept payments, subscriptions and invoices in your generated app.',
    status: 'available',
    authType: 'api_key',
    mark: 'St',
    color: '#635bff',
    fields: [
      {
        key: 'secretKey',
        label: 'Secret or restricted key',
        secret: true,
        required: true,
        placeholder: 'sk_test_… or rk_live_…',
        pattern: /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/,
        patternMessage: 'Use a Stripe secret (sk_) or restricted (rk_) key. Publishable keys are not accepted.',
        envVar: 'STRIPE_SECRET_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Read: balance (used for the connection test)', 'Write: charges, customers, checkout sessions (as your app needs)'],
    docsUrl: 'https://docs.stripe.com/keys',
    costNote: 'Stripe charges its standard processing fees (2.9% + 30¢ in the US). AppWeaver adds no fee.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.stripe.com/v1/balance',
        init: { headers: bearer(c.secretKey) },
        service: 'Stripe',
        successMessage: `Stripe accepted the key (${c.secretKey.includes('_live_') ? 'live' : 'test'} mode).`,
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `import Stripe from 'stripe';

// app/api/checkout/route.ts (server only)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: 'https://example.com/success',
  });
  return Response.json({ url: session.url });
}`,
    },
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'Email',
    description: 'Send transactional and marketing email through Twilio SendGrid.',
    status: 'available',
    authType: 'api_key',
    mark: 'Sg',
    color: '#1a82e2',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 'SG.…',
        pattern: /^SG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/,
        patternMessage: 'SendGrid keys look like SG.xxxx.yyyy.',
        envVar: 'SENDGRID_API_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Mail Send (full access to Mail Send is enough)', 'The test reads the key’s own scopes'],
    docsUrl: 'https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys',
    costNote: 'SendGrid free plan covers 100 emails/day; paid plans are billed by SendGrid.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.sendgrid.com/v3/scopes',
        init: { headers: bearer(c.apiKey) },
        service: 'SendGrid',
        successMessage: 'SendGrid accepted the API key.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.SENDGRID_API_KEY}\`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM! },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) throw new Error('Email send failed');
}`,
    },
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'Email',
    description: 'Developer-friendly transactional email API.',
    status: 'available',
    authType: 'api_key',
    mark: 'Re',
    color: '#111111',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 're_…',
        pattern: /^re_[A-Za-z0-9_]{10,}$/,
        patternMessage: 'Resend keys start with re_.',
        envVar: 'RESEND_API_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Full access, or sending access plus domain read for the test'],
    docsUrl: 'https://resend.com/docs/api-reference/api-keys/create-api-key',
    costNote: 'Free tier includes 3,000 emails/month; paid plans are billed by Resend.',
    test: async (c, ctx) => {
      const res = await ctx
        .fetch('https://api.resend.com/domains', { headers: bearer(c.apiKey), signal: AbortSignal.timeout(10_000) })
        .catch(() => null);
      if (!res) return { ok: false, message: 'Could not reach Resend. Check your network or try again.' };
      if (res.ok) return { ok: true, message: 'Resend accepted the API key.' };
      // Sending-only keys cannot list domains; Resend answers 401 "restricted_api_key", which proves the key is valid.
      const body = (await res.json().catch(() => null)) as { name?: string } | null;
      if (res.status === 401 && body?.name === 'restricted_api_key') {
        return { ok: true, message: 'Resend accepted the API key (sending-only access).' };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, message: `Resend rejected the credentials (HTTP ${res.status}).` };
      return { ok: false, message: `Resend responded with HTTP ${res.status}.` };
    },
    setup: {
      note: SERVER_NOTE,
      snippet: `import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcome(to: string) {
  await resend.emails.send({ from: process.env.EMAIL_FROM!, to, subject: 'Welcome', html: '<p>Hi!</p>' });
}`,
    },
  },
  {
    id: 'postmark',
    name: 'Postmark',
    category: 'Email',
    description: 'Fast, reliable transactional email with delivery tracking.',
    status: 'available',
    authType: 'api_key',
    mark: 'Pm',
    color: '#ffde00',
    fields: [
      {
        key: 'serverToken',
        label: 'Server API token',
        secret: true,
        required: true,
        pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        patternMessage: 'Postmark server tokens are UUIDs.',
        envVar: 'POSTMARK_SERVER_TOKEN',
        maxLength: 64,
      },
    ],
    scopes: ['Server API token for one Postmark server (read server details, send email)'],
    docsUrl: 'https://postmarkapp.com/developer/api/overview',
    costNote: 'Postmark includes 100 test emails/month; paid plans are billed by Postmark.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.postmarkapp.com/server',
        init: { headers: { 'x-postmark-server-token': c.serverToken, accept: 'application/json' } },
        service: 'Postmark',
        successMessage: 'Postmark accepted the server token.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function sendEmail(to: string, subject: string, htmlBody: string) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'x-postmark-server-token': process.env.POSTMARK_SERVER_TOKEN!,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ From: process.env.EMAIL_FROM, To: to, Subject: subject, HtmlBody: htmlBody }),
  });
  if (!res.ok) throw new Error('Email send failed');
}`,
    },
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'CRM',
    description: 'Sync contacts, deals and forms with HubSpot CRM using a private app token.',
    status: 'available',
    authType: 'api_key',
    mark: 'Hs',
    color: '#ff7a59',
    fields: [
      {
        key: 'accessToken',
        label: 'Private app access token',
        secret: true,
        required: true,
        placeholder: 'pat-na1-…',
        pattern: /^pat-[a-z0-9]+-[0-9a-f-]{36}$/i,
        patternMessage: 'HubSpot private app tokens look like pat-na1-xxxxxxxx-….',
        envVar: 'HUBSPOT_ACCESS_TOKEN',
        maxLength: 255,
      },
    ],
    scopes: ['crm.objects.owners.read (connection test)', 'crm.objects.contacts.read / write (as your app needs)'],
    docsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    costNote: 'The HubSpot API is free to call; API rate limits and CRM seats follow your HubSpot plan.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.hubapi.com/crm/v3/owners?limit=1',
        init: { headers: bearer(c.accessToken) },
        service: 'HubSpot',
        successMessage: 'HubSpot accepted the access token.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function createContact(email: string) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.HUBSPOT_ACCESS_TOKEN}\`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties: { email } }),
  });
  if (!res.ok) throw new Error('HubSpot request failed');
  return res.json();
}`,
    },
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'Analytics',
    description: 'Product analytics, session replay and feature flags.',
    status: 'available',
    authType: 'api_key',
    mark: 'Ph',
    color: '#f9bd2b',
    fields: [
      {
        key: 'host',
        label: 'Region',
        secret: false,
        required: true,
        options: ['https://us.posthog.com', 'https://eu.posthog.com'],
        envVar: 'POSTHOG_HOST',
      },
      {
        key: 'projectApiKey',
        label: 'Project API key',
        secret: false,
        required: true,
        placeholder: 'phc_…',
        pattern: /^phc_[A-Za-z0-9]{10,}$/,
        patternMessage: 'PostHog project keys start with phc_.',
        envVar: 'POSTHOG_PROJECT_API_KEY',
        help: 'Used server-side for capture. It is injected as a server env var, not a NEXT_PUBLIC_ one.',
      },
      {
        key: 'personalApiKey',
        label: 'Personal API key',
        secret: true,
        required: true,
        placeholder: 'phx_…',
        pattern: /^phx_[A-Za-z0-9]{10,}$/,
        patternMessage: 'PostHog personal API keys start with phx_.',
        envVar: 'POSTHOG_PERSONAL_API_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Personal API key with "user:read" (connection test) and the read scopes your queries need'],
    docsUrl: 'https://posthog.com/docs/api',
    costNote: 'PostHog has a generous free tier; usage beyond it is billed by PostHog.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: `${c.host}/api/users/@me/`,
        init: { headers: bearer(c.personalApiKey) },
        service: 'PostHog',
        successMessage: 'PostHog accepted the personal API key.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function capture(distinctId: string, event: string, properties: Record<string, unknown> = {}) {
  await fetch(\`\${process.env.POSTHOG_HOST!.replace('posthog.com', 'i.posthog.com')}/capture/\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: process.env.POSTHOG_PROJECT_API_KEY, event, distinct_id: distinctId, properties }),
  });
}`,
    },
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics 4',
    category: 'Analytics',
    description: 'Send server-side events with the GA4 Measurement Protocol.',
    status: 'available',
    authType: 'api_key',
    mark: 'GA',
    color: '#e8710a',
    fields: [
      {
        key: 'measurementId',
        label: 'Measurement ID',
        secret: false,
        required: true,
        placeholder: 'G-XXXXXXXXXX',
        pattern: /^G-[A-Z0-9]{6,12}$/,
        patternMessage: 'Measurement IDs look like G-XXXXXXXXXX.',
        envVar: 'GA_MEASUREMENT_ID',
      },
      {
        key: 'apiSecret',
        label: 'Measurement Protocol API secret',
        secret: true,
        required: true,
        pattern: /^[A-Za-z0-9_-]{10,64}$/,
        patternMessage: 'Paste the API secret from Admin → Data streams → Measurement Protocol.',
        envVar: 'GA_API_SECRET',
        maxLength: 64,
      },
    ],
    scopes: ['Measurement Protocol API secret for the data stream (write events only)'],
    warnings: ['Google offers no read call to verify an API secret, so the test confirms the request format only.'],
    docsUrl: 'https://developers.google.com/analytics/devguides/collection/protocol/ga4',
    costNote: 'Google Analytics 4 is free; GA360 is a separate paid product.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(c.measurementId)}&api_secret=${encodeURIComponent(c.apiSecret)}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: 'appweaver.test', events: [{ name: 'connection_test' }] }),
        },
        service: 'Google Analytics',
        // The debug endpoint validates the payload without recording any data.
        accept: (body) => {
          const messages = (body as { validationMessages?: unknown[] } | null)?.validationMessages;
          return Array.isArray(messages) && messages.length === 0
            ? true
            : 'Google Analytics reported validation problems. Check the Measurement ID and API secret.';
        },
        successMessage: 'Google validated the event format (no data was recorded). Google cannot verify the API secret until real events are sent.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function trackEvent(clientId: string, name: string, params: Record<string, unknown> = {}) {
  await fetch(
    \`https://www.google-analytics.com/mp/collect?measurement_id=\${process.env.GA_MEASUREMENT_ID}&api_secret=\${process.env.GA_API_SECRET}\`,
    { method: 'POST', body: JSON.stringify({ client_id: clientId, events: [{ name, params }] }) },
  );
}`,
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'AI models',
    description: 'GPT language, vision and embedding models for features in your app.',
    status: 'available',
    authType: 'api_key',
    mark: 'Oa',
    color: '#10a37f',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 'sk-…',
        pattern: /^sk-[A-Za-z0-9_-]{20,}$/,
        patternMessage: 'OpenAI keys start with sk-.',
        envVar: 'OPENAI_API_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Models: read (connection test)', 'Model capabilities: whichever your app calls (restricted keys supported)'],
    docsUrl: 'https://platform.openai.com/docs/api-reference/authentication',
    costNote: 'Billed per token by OpenAI directly on your account. Set a usage limit in the OpenAI dashboard.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.openai.com/v1/models',
        init: { headers: bearer(c.apiKey) },
        service: 'OpenAI',
        successMessage: 'OpenAI accepted the API key.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function ask(prompt: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.OPENAI_API_KEY}\`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content as string | undefined;
}`,
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'AI models',
    description: 'Claude models for chat, analysis and agents inside your app.',
    status: 'available',
    authType: 'api_key',
    mark: 'An',
    color: '#d97757',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 'sk-ant-…',
        pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
        patternMessage: 'Anthropic keys start with sk-ant-.',
        envVar: 'ANTHROPIC_API_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Workspace API key with access to the Messages API'],
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    costNote: 'Billed per token by Anthropic directly on your account. Set a spend limit in the Anthropic console.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.anthropic.com/v1/models?limit=1',
        init: { headers: { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' } },
        service: 'Anthropic',
        successMessage: 'Anthropic accepted the API key.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function ask(prompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text as string | undefined;
}`,
    },
  },
  {
    id: 'replicate',
    name: 'Replicate',
    category: 'Media generation',
    description: 'Run image, video and audio generation models through one API.',
    status: 'available',
    authType: 'api_key',
    mark: 'Rp',
    color: '#000000',
    fields: [
      {
        key: 'apiToken',
        label: 'API token',
        secret: true,
        required: true,
        placeholder: 'r8_…',
        pattern: /^r8_[A-Za-z0-9]{20,}$/,
        patternMessage: 'Replicate tokens start with r8_.',
        envVar: 'REPLICATE_API_TOKEN',
        maxLength: 255,
      },
    ],
    scopes: ['Account API token (read account for the test; run predictions)'],
    docsUrl: 'https://replicate.com/docs/reference/http',
    costNote: 'Billed per second of compute by Replicate; costs vary a lot by model.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.replicate.com/v1/account',
        init: { headers: bearer(c.apiToken) },
        service: 'Replicate',
        successMessage: 'Replicate accepted the API token.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function generateImage(prompt: string) {
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.REPLICATE_API_TOKEN}\`, 'content-type': 'application/json', prefer: 'wait' },
    body: JSON.stringify({ input: { prompt } }),
  });
  return res.json();
}`,
    },
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'Media generation',
    description: 'Realistic text-to-speech and voice generation.',
    status: 'available',
    authType: 'api_key',
    mark: 'El',
    color: '#111827',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        pattern: /^[A-Za-z0-9_-]{20,}$/,
        patternMessage: 'Paste the API key from your ElevenLabs profile.',
        envVar: 'ELEVENLABS_API_KEY',
        maxLength: 255,
      },
    ],
    scopes: ['Text to speech access; "user_read" for the connection test'],
    docsUrl: 'https://elevenlabs.io/docs/api-reference/authentication',
    costNote: 'Billed in characters against your ElevenLabs plan quota.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://api.elevenlabs.io/v1/models',
        init: { headers: { 'xi-api-key': c.apiKey } },
        service: 'ElevenLabs',
        successMessage: 'ElevenLabs accepted the API key.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function speak(text: string, voiceId: string) {
  const res = await fetch(\`https://api.elevenlabs.io/v1/text-to-speech/\${voiceId}\`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  });
  return new Response(res.body, { headers: { 'content-type': 'audio/mpeg' } });
}`,
    },
  },
  {
    id: 'twilio',
    name: 'Twilio',
    category: 'Communication',
    description: 'Send SMS and WhatsApp messages and make calls.',
    status: 'available',
    authType: 'api_key',
    mark: 'Tw',
    color: '#f22f46',
    fields: [
      {
        key: 'accountSid',
        label: 'Account SID',
        secret: false,
        required: true,
        placeholder: 'AC…',
        pattern: /^AC[0-9a-f]{32}$/i,
        patternMessage: 'Account SIDs start with AC and are 34 characters.',
        envVar: 'TWILIO_ACCOUNT_SID',
      },
      {
        key: 'authToken',
        label: 'Auth token',
        secret: true,
        required: true,
        pattern: /^[0-9a-f]{32}$/i,
        patternMessage: 'Auth tokens are 32 hex characters.',
        envVar: 'TWILIO_AUTH_TOKEN',
        maxLength: 64,
      },
    ],
    scopes: ['Account-level credentials (read account for the test; send messages)'],
    docsUrl: 'https://www.twilio.com/docs/usage/api',
    costNote: 'Twilio bills per message/minute (SMS from about $0.008 in the US). Billed by Twilio.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}.json`,
        init: { headers: { authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}` } },
        service: 'Twilio',
        successMessage: 'Twilio accepted the Account SID and auth token.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(\`https://api.twilio.com/2010-04-01/Accounts/\${sid}/Messages.json\`, {
    method: 'POST',
    headers: {
      authorization: \`Basic \${Buffer.from(\`\${sid}:\${process.env.TWILIO_AUTH_TOKEN}\`).toString('base64')}\`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
  });
  if (!res.ok) throw new Error('SMS failed');
}`,
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Communication',
    description: 'Post messages and alerts to Slack channels with a bot token.',
    status: 'available',
    authType: 'api_key',
    mark: 'Sl',
    color: '#4a154b',
    fields: [
      {
        key: 'botToken',
        label: 'Bot user OAuth token',
        secret: true,
        required: true,
        placeholder: 'xoxb-…',
        pattern: /^xox[bp]-[A-Za-z0-9-]{10,}$/,
        patternMessage: 'Slack bot tokens start with xoxb-.',
        envVar: 'SLACK_BOT_TOKEN',
        maxLength: 255,
      },
    ],
    scopes: ['chat:write (post messages)', 'auth.test needs no extra scope (connection test)'],
    docsUrl: 'https://api.slack.com/authentication/token-types#bot',
    costNote: 'The Slack API is free; limits follow your Slack plan.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: 'https://slack.com/api/auth.test',
        init: { method: 'POST', headers: bearer(c.botToken) },
        service: 'Slack',
        accept: (body) => ((body as { ok?: boolean } | null)?.ok === true ? true : 'Slack rejected the bot token.'),
        successMessage: 'Slack accepted the bot token.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `export async function postToSlack(channel: string, text: string) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.SLACK_BOT_TOKEN}\`, 'content-type': 'application/json' },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error('Slack post failed');
}`,
    },
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Databases',
    description: 'Use a Supabase project’s REST API, auth and storage from your server code.',
    status: 'available',
    authType: 'api_key',
    mark: 'Sb',
    color: '#3ecf8e',
    fields: [
      {
        key: 'url',
        label: 'Project URL',
        secret: false,
        required: true,
        placeholder: 'https://xxxx.supabase.co',
        pattern: /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/,
        patternMessage: 'Use your project URL, e.g. https://abcd.supabase.co.',
        envVar: 'SUPABASE_URL',
      },
      {
        key: 'serviceRoleKey',
        label: 'Service role key',
        secret: true,
        required: true,
        pattern: /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]+)$/,
        patternMessage: 'Paste the service_role (or sb_secret_) key from Project Settings → API.',
        envVar: 'SUPABASE_SERVICE_ROLE_KEY',
        maxLength: 2_048,
      },
    ],
    scopes: ['service_role key: bypasses Row Level Security. Keep it on the server only.'],
    warnings: [
      'The service role key has full access to your data. It is injected only as a server-side secret and must never be used in browser code.',
    ],
    docsUrl: 'https://supabase.com/docs/guides/api/api-keys',
    costNote: 'Supabase bills by plan (free tier available). AppWeaver adds no fee.',
    test: (c, ctx) =>
      probe({
        fetch: ctx.fetch,
        url: `${c.url}/rest/v1/`,
        init: { headers: { apikey: c.serviceRoleKey, authorization: `Bearer ${c.serviceRoleKey}` } },
        service: 'Supabase',
        successMessage: 'Supabase accepted the service role key.',
      }),
    setup: {
      note: SERVER_NOTE,
      snippet: `import { createClient } from '@supabase/supabase-js';

// lib/supabase-server.ts: import only from server code
export const supabaseAdmin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});`,
    },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'Databases',
    description: 'Connect an external PostgreSQL database with a connection string.',
    status: 'available',
    authType: 'connection_string',
    mark: 'Pg',
    color: '#336791',
    fields: [
      {
        key: 'connectionString',
        label: 'Connection string',
        secret: true,
        required: true,
        placeholder: 'postgresql://user:password@host:5432/db?sslmode=require',
        pattern: /^postgres(ql)?:\/\/\S+$/,
        patternMessage: 'Use a postgres:// or postgresql:// connection string.',
        envVar: 'EXTERNAL_DATABASE_URL',
        maxLength: 2_048,
        help: 'Saved as EXTERNAL_DATABASE_URL so it never replaces your managed DATABASE_URL.',
      },
    ],
    scopes: ['A database user with the least privilege your app needs. Use a read-only user where possible.'],
    warnings: [
      'The database must be reachable from the public internet, which exposes it to attack. Use TLS, a strong password and an IP allow-list where your provider supports one.',
      'Credentials are injected as server-side secrets only and are never exposed to browsers or generated frontend code.',
      'The connection test uses TLS and runs a read-only query. Private or local addresses are refused.',
    ],
    docsUrl: 'https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING',
    costNote: 'No AppWeaver fee. Hosting cost is whatever your database provider charges.',
    test: (c) => testPostgresConnection(c.connectionString),
    setup: {
      note: SERVER_NOTE,
      snippet: `import { Pool } from 'pg';

// lib/external-db.ts: import only from server code
export const externalDb = new Pool({ connectionString: process.env.EXTERNAL_DATABASE_URL, max: 5 });`,
    },
  },
  {
    id: 'rest-api',
    name: 'REST API',
    category: 'APIs',
    description: 'Call any REST API through a secure server-side proxy with your credentials kept private.',
    status: 'available',
    authType: 'api_key',
    mark: 'Rs',
    color: '#0ea5e9',
    userDefinedUrl: true,
    proxyUrlEnvVar: 'REST_API_PROXY_URL',
    fields: [
      { key: 'baseUrl', label: 'Base URL', secret: false, required: true, placeholder: 'https://api.example.com/v1', maxLength: 512 },
      {
        key: 'authScheme',
        label: 'Authentication',
        secret: false,
        required: true,
        options: ['none', 'bearer', 'header', 'basic'],
      },
      { key: 'authHeaderName', label: 'Header name (for "header" auth)', secret: false, required: false, placeholder: 'X-API-Key', pattern: /^[A-Za-z0-9-]{1,64}$/, patternMessage: 'Header names may contain letters, numbers and dashes.' },
      { key: 'basicUsername', label: 'Username (for "basic" auth)', secret: false, required: false, maxLength: 128 },
      { key: 'authSecret', label: 'Token / key / password', secret: true, required: false, maxLength: 2_048 },
      { key: 'allowedMethods', label: 'Allowed methods', secret: false, required: false, placeholder: 'GET,POST', pattern: /^(GET|POST|PUT|PATCH|DELETE)(\s*,\s*(GET|POST|PUT|PATCH|DELETE))*$/i, patternMessage: 'Use a comma-separated list of GET, POST, PUT, PATCH, DELETE.' },
      { key: 'allowedPaths', label: 'Allowed path prefixes', secret: false, required: false, placeholder: '/users,/orders', pattern: /^\/[^\s,]*(\s*,\s*\/[^\s,]*)*$/, patternMessage: 'Use comma-separated paths that start with "/".' },
      { key: 'timeoutMs', label: 'Timeout (ms, max 30000)', secret: false, required: false, placeholder: '10000', pattern: /^\d{4,5}$/, patternMessage: 'Enter 1000–30000.' },
      { key: 'maxResponseKb', label: 'Max response size (KB, max 2048)', secret: false, required: false, placeholder: '512', pattern: /^\d{1,4}$/, patternMessage: 'Enter 1–2048.' },
      { key: 'testPath', label: 'Test path (GET)', secret: false, required: false, placeholder: '/health', pattern: /^\/[^\s?#]*$/, patternMessage: 'Start with "/".' },
    ],
    scopes: ['Whatever the target API token allows. AppWeaver only forwards the methods and paths you allow.'],
    warnings: [
      'Requests run from AppWeaver servers to public https:// hosts only. Private, local and link-local addresses are blocked.',
      'Your app calls the proxy with a project token; the upstream credential is never sent to the browser.',
    ],
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods',
    costNote: 'No AppWeaver fee. Proxy calls are limited per minute and per day for each project.',
    validate: (v) => {
      const target = validateOutboundUrl(v.baseUrl ?? '');
      if (!target.ok) return target.reason;
      if ((v.authScheme ?? 'none') !== 'none' && !v.authSecret) return 'Enter the token, key or password for the chosen authentication.';
      if (v.authScheme === 'basic' && !v.basicUsername) return 'Enter the username for basic authentication.';
      const timeout = Number(v.timeoutMs);
      if (v.timeoutMs && (timeout < 1_000 || timeout > 30_000)) return 'Timeout must be between 1000 and 30000 ms.';
      const max = Number(v.maxResponseKb);
      if (v.maxResponseKb && (max < 1 || max > 2_048)) return 'Max response size must be between 1 and 2048 KB.';
      return null;
    },
    test: async (c, ctx) => {
      const config = parseConnectorConfig(c);
      const target = `${config.baseUrl}${config.testPath}`;
      return probe({
        fetch: ctx.safeFetch,
        url: target,
        init: { method: 'GET', headers: buildAuthHeaders(config, c.authSecret ?? '') },
        service: 'The API',
        timeoutMs: config.timeoutMs,
        successMessage: 'The API responded successfully to a read-only GET.',
      });
    },
    setup: {
      note: 'Call the proxy from your server code with the project proxy token. The upstream credential never leaves AppWeaver.',
      snippet: `export async function callApi(path: string) {
  const res = await fetch(process.env.REST_API_PROXY_URL!, {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.APPWEAVER_PROXY_TOKEN}\`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'GET', path }),
  });
  return res.json() as Promise<{ status: number; body: unknown }>;
}`,
    },
  },
  {
    id: 'graphql-api',
    name: 'GraphQL API',
    category: 'APIs',
    description: 'Query any GraphQL endpoint through the same secure server-side proxy.',
    status: 'available',
    authType: 'api_key',
    mark: 'Gq',
    color: '#e535ab',
    userDefinedUrl: true,
    proxyUrlEnvVar: 'GRAPHQL_PROXY_URL',
    fields: [
      { key: 'baseUrl', label: 'Endpoint URL', secret: false, required: true, placeholder: 'https://api.example.com/graphql', maxLength: 512 },
      { key: 'authScheme', label: 'Authentication', secret: false, required: true, options: ['none', 'bearer', 'header', 'basic'] },
      { key: 'authHeaderName', label: 'Header name (for "header" auth)', secret: false, required: false, placeholder: 'X-API-Key', pattern: /^[A-Za-z0-9-]{1,64}$/, patternMessage: 'Header names may contain letters, numbers and dashes.' },
      { key: 'basicUsername', label: 'Username (for "basic" auth)', secret: false, required: false, maxLength: 128 },
      { key: 'authSecret', label: 'Token / key / password', secret: true, required: false, maxLength: 2_048 },
      { key: 'timeoutMs', label: 'Timeout (ms, max 30000)', secret: false, required: false, placeholder: '10000', pattern: /^\d{4,5}$/, patternMessage: 'Enter 1000–30000.' },
      { key: 'maxResponseKb', label: 'Max response size (KB, max 2048)', secret: false, required: false, placeholder: '512', pattern: /^\d{1,4}$/, patternMessage: 'Enter 1–2048.' },
    ],
    scopes: ['Whatever the target API token allows. Only POST to the endpoint path is forwarded.'],
    warnings: ['Requests run from AppWeaver servers to public https:// hosts only. Private and local addresses are blocked.'],
    docsUrl: 'https://graphql.org/learn/serving-over-http/',
    costNote: 'No AppWeaver fee. Proxy calls are limited per minute and per day for each project.',
    validate: (v) => {
      const target = validateOutboundUrl(v.baseUrl ?? '');
      if (!target.ok) return target.reason;
      if ((v.authScheme ?? 'none') !== 'none' && !v.authSecret) return 'Enter the token, key or password for the chosen authentication.';
      if (v.authScheme === 'basic' && !v.basicUsername) return 'Enter the username for basic authentication.';
      return null;
    },
    test: async (c, ctx) => {
      const config = parseConnectorConfig(c);
      const headers = buildAuthHeaders(config, c.authSecret ?? '');
      headers.set('content-type', 'application/json');
      return probe({
        fetch: ctx.safeFetch,
        url: config.baseUrl,
        init: { method: 'POST', headers, body: JSON.stringify({ query: '{ __typename }' }) },
        service: 'The GraphQL endpoint',
        timeoutMs: config.timeoutMs,
        accept: (body) => {
          const data = (body as { data?: { __typename?: string } } | null)?.data;
          return data?.__typename ? true : 'The endpoint answered, but not with a valid GraphQL response.';
        },
        successMessage: 'The endpoint answered a read-only { __typename } query.',
      });
    },
    setup: {
      note: 'Send GraphQL operations through the proxy: { "method": "POST", "path": "/", "body": { "query": "…" } }.',
      snippet: `export async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(process.env.GRAPHQL_PROXY_URL!, {
    method: 'POST',
    headers: { authorization: \`Bearer \${process.env.APPWEAVER_PROXY_TOKEN}\`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'POST', path: '/', body: { query, variables } }),
  });
  return res.json();
}`,
    },
  },
  {
    id: 'webhooks-incoming',
    name: 'Incoming webhooks',
    category: 'APIs',
    description: 'Receive signed events from other services at a per-project URL with replay protection and de-duplication.',
    status: 'available',
    authType: 'webhook',
    mark: '↘',
    color: '#14b8a6',
    platformFeature: 'webhooks_inbound',
    fields: [],
    scopes: ['Senders sign each request with HMAC-SHA256 using the endpoint secret.'],
    docsUrl: 'https://en.wikipedia.org/wiki/Webhook',
    costNote: 'No AppWeaver fee. Payloads are capped at 256 KB.',
  },
  {
    id: 'webhooks-outgoing',
    name: 'Outgoing webhooks',
    category: 'APIs',
    description: 'Send signed events from your app to any public URL, with automatic retries and a delivery log.',
    status: 'available',
    authType: 'webhook',
    mark: '↗',
    color: '#8b5cf6',
    platformFeature: 'webhooks_outbound',
    fields: [],
    scopes: ['Each delivery is signed with HMAC-SHA256 using the subscription secret.'],
    docsUrl: 'https://en.wikipedia.org/wiki/Webhook',
    costNote: 'No AppWeaver fee. Failed deliveries are retried up to 6 times with backoff.',
  },
];
