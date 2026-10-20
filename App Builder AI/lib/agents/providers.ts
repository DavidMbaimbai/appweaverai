export type ProviderHealth = {
  id: string;
  label: string;
  configured: boolean;
  missing: string[];
  note?: string;
};

type Spec = { id: string; label: string; required: string[]; anyOf?: string[][]; note?: string };

const SPECS: Spec[] = [
  { id: 'meta', label: 'Meta (Facebook/Instagram/Ads)', required: ['META_APP_ID', 'META_APP_SECRET', 'META_PAGE_ID', 'META_ADS_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'] },
  { id: 'x', label: 'X', required: ['X_USER_ACCESS_TOKEN'] },
  { id: 'linkedin', label: 'LinkedIn', required: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'] },
  { id: 'youtube', label: 'YouTube', required: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'] },
  { id: 'tiktok', label: 'TikTok', required: ['TIKTOK_ACCESS_TOKEN'] },
  { id: 'twilio', label: 'Twilio (SMS/voice)', required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], anyOf: [['TWILIO_FROM_NUMBER', 'TWILIO_MESSAGING_SERVICE_SID']] },
  {
    id: 'whatsapp',
    label: 'WhatsApp (via Twilio)',
    required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'],
    note: 'WhatsApp sending is not built into the app yet; these variables are what it will need.',
  },
  { id: 'bedrock', label: 'AWS Bedrock (AI)', required: ['AWS_REGION', 'BEDROCK_MODEL_ID'], anyOf: [['AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_ROLE_ARN']] },
  { id: 's3', label: 'S3 (media storage)', required: ['MARKETING_S3_BUCKET', 'VIDEO_S3_BUCKET'] },
  { id: 'email', label: 'Email (SMTP)', required: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] },
];

/** Reports which integrations have their env vars set, listing the exact missing names. Never returns values. */
export function providerHealth(env: Record<string, string | undefined> = process.env): ProviderHealth[] {
  return SPECS.map((spec) => {
    const missing = spec.required.filter((name) => !env[name]);
    for (const group of spec.anyOf ?? []) {
      if (!group.some((name) => env[name])) missing.push(group.join(' or '));
    }
    return { id: spec.id, label: spec.label, configured: missing.length === 0, missing, note: spec.note };
  });
}
