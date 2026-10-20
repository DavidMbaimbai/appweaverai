import type { IntegrationCategory, IntegrationDefinition } from './types';

function soon(
  id: string,
  name: string,
  category: IntegrationCategory,
  description: string,
  mark: string,
  color: string,
  docsUrl: string,
): IntegrationDefinition {
  return {
    id,
    name,
    category,
    description,
    status: 'coming_soon',
    authType: 'api_key',
    mark,
    color,
    fields: [],
    scopes: [],
    docsUrl,
    costNote: 'Not available yet.',
  };
}

/** Listed for transparency only. None of these can be connected until connect + test are implemented. */
export const COMING_SOON_INTEGRATIONS: readonly IntegrationDefinition[] = [
  soon('salesforce', 'Salesforce', 'CRM', 'Sync leads, accounts and opportunities (needs OAuth).', 'Sf', '#00a1e0', 'https://developer.salesforce.com/docs'),
  soon('paypal', 'PayPal', 'Payments', 'Accept PayPal checkout.', 'Pp', '#003087', 'https://developer.paypal.com/docs/api/overview/'),
  soon('mailgun', 'Mailgun', 'Email', 'Transactional email delivery.', 'Mg', '#f06b66', 'https://documentation.mailgun.com/'),
  soon('mixpanel', 'Mixpanel', 'Analytics', 'Event analytics and funnels.', 'Mx', '#7856ff', 'https://developer.mixpanel.com/'),
  soon('google-gemini', 'Google Gemini', 'AI models', 'Gemini language and vision models.', 'Gm', '#4285f4', 'https://ai.google.dev/gemini-api/docs'),
  soon('mongodb', 'MongoDB', 'Databases', 'Document database connection.', 'Mo', '#00ed64', 'https://www.mongodb.com/docs/'),
  soon('mysql', 'MySQL', 'Databases', 'MySQL connection string.', 'My', '#00758f', 'https://dev.mysql.com/doc/'),
  soon('discord', 'Discord', 'Communication', 'Post to Discord channels.', 'Dc', '#5865f2', 'https://discord.com/developers/docs'),
  soon('notion', 'Notion', 'Dev tools', 'Read and write Notion pages (needs OAuth).', 'No', '#000000', 'https://developers.notion.com/'),
  soon('linear', 'Linear', 'Dev tools', 'Create and track issues.', 'Li', '#5e6ad2', 'https://developers.linear.app/'),
  soon('stability-ai', 'Stability AI', 'Media generation', 'Image generation models.', 'Sa', '#7c3aed', 'https://platform.stability.ai/docs'),
];
