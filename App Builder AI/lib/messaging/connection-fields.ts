import type { MessageChannelName } from './types';

/** Fields a project owner fills in to connect their own account (stored encrypted). Client-safe: no server imports. */
export const PROJECT_CONNECTION_FIELDS_VIEW: Partial<Record<MessageChannelName, Array<{ key: string; label: string; secret: boolean }>>> = {
  WHATSAPP: [
    { key: 'phoneNumberId', label: 'WhatsApp phone number ID', secret: false },
    { key: 'accessToken', label: 'WhatsApp Cloud API access token', secret: true },
    { key: 'approvedTemplates', label: 'Approved template names (comma separated)', secret: false },
  ],
  SMS: [
    { key: 'accountSid', label: 'Twilio account SID', secret: false },
    { key: 'authToken', label: 'Twilio auth token', secret: true },
    { key: 'from', label: 'Twilio number (+E.164)', secret: false },
  ],
  FACEBOOK: [
    { key: 'pageId', label: 'Facebook Page ID', secret: false },
    { key: 'accessToken', label: 'Page access token', secret: true },
  ],
  INSTAGRAM: [
    { key: 'pageId', label: 'Instagram business account ID', secret: false },
    { key: 'accessToken', label: 'Instagram access token', secret: true },
  ],
};
