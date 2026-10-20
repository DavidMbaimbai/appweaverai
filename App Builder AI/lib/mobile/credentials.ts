import type { MobileStoreId } from './listing';

export type StoreCredentialInput =
  | { store: 'GOOGLE_PLAY'; serviceAccountJson: string }
  | { store: 'APP_STORE_CONNECT'; keyId: string; issuerId: string; privateKey: string };

export type ParsedCredential = { payload: string; hint: string };

const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/;

/** Validates the shape only; it never contacts the store. Returns the JSON payload to encrypt and a non-secret hint. */
export function parseStoreCredential(input: StoreCredentialInput): ParsedCredential | { error: string } {
  if (input.store === 'GOOGLE_PLAY') {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(input.serviceAccountJson) as Record<string, unknown>;
    } catch {
      return { error: 'The service account key must be the JSON file downloaded from Google Cloud.' };
    }
    const email = json.client_email;
    const key = json.private_key;
    if (json.type !== 'service_account' || typeof email !== 'string' || typeof key !== 'string' || !PEM.test(key)) {
      return { error: 'This does not look like a Google service account key (needs type, client_email and private_key).' };
    }
    return { payload: JSON.stringify({ type: 'service_account', client_email: email, private_key: key, project_id: json.project_id }), hint: email };
  }

  const keyId = input.keyId.trim();
  const issuerId = input.issuerId.trim();
  if (!/^[A-Z0-9]{10}$/.test(keyId)) return { error: 'Key ID must be the 10-character App Store Connect key id.' };
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(issuerId)) {
    return { error: 'Issuer ID must be the UUID shown in App Store Connect > Users and Access > Integrations.' };
  }
  if (!PEM.test(input.privateKey)) return { error: 'Paste the full contents of the downloaded .p8 private key.' };
  return { payload: JSON.stringify({ keyId, issuerId, privateKey: input.privateKey.trim() }), hint: `Key ${keyId}` };
}

export function storeForPlatform(platform: 'ANDROID' | 'IOS'): MobileStoreId {
  return platform === 'ANDROID' ? 'GOOGLE_PLAY' : 'APP_STORE_CONNECT';
}
