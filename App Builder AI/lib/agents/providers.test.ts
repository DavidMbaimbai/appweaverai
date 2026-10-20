import { describe, expect, it } from 'vitest';

import { providerHealth } from '@/lib/agents/providers';

describe('providerHealth', () => {
  it('lists exact missing env var names and never values', () => {
    const result = providerHealth({ X_USER_ACCESS_TOKEN: 'secret', TWILIO_ACCOUNT_SID: 'AC1' });
    expect(result.find((p) => p.id === 'x')).toMatchObject({ configured: true, missing: [] });
    const twilio = result.find((p) => p.id === 'twilio')!;
    expect(twilio.configured).toBe(false);
    expect(twilio.missing).toEqual(['TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('accepts any one credential source for Bedrock', () => {
    const env = { AWS_REGION: 'eu-west-1', BEDROCK_MODEL_ID: 'm', AWS_PROFILE: 'p' };
    expect(providerHealth(env).find((p) => p.id === 'bedrock')!.configured).toBe(true);
  });
});
