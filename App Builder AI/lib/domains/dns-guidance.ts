/** Pure helpers describing the DNS records a custom domain needs. */

const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'co.nz',
  'co.za',
  'co.in',
  'co.jp',
  'com.br',
  'com.mx',
  'com.tr',
]);

export type DnsRecord = {
  type: 'CNAME' | 'A' | 'TXT';
  name: string;
  value: string;
  purpose: 'routing' | 'verification';
};

export type DnsGuidance = {
  isApex: boolean;
  records: DnsRecord[];
  notes: string[];
};

export function getHostingDnsTargets() {
  return {
    cname: process.env.HOSTING_CNAME_TARGET?.trim() || 'cname.vercel-dns.com',
    a: process.env.HOSTING_A_RECORD?.trim() || '76.76.21.21',
  };
}

export function isApexDomain(domain: string) {
  const labels = domain.toLowerCase().split('.');
  const lastTwo = labels.slice(-2).join('.');
  return labels.length === (MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2);
}

export function verificationRecordName(domain: string) {
  return `_appweaverai-verify.${domain}`;
}

export function getDnsGuidance(
  domain: string,
  verificationToken: string,
  targets = getHostingDnsTargets(),
): DnsGuidance {
  const isApex = isApexDomain(domain);

  const routing: DnsRecord = isApex
    ? { type: 'A', name: '@ (root)', value: targets.a, purpose: 'routing' }
    : { type: 'CNAME', name: domain, value: targets.cname, purpose: 'routing' };

  const notes = isApex
    ? [
        'Root domains cannot use a CNAME. Use the A record, or an ALIAS/ANAME record pointing to ' +
          targets.cname +
          ' if your DNS provider supports it.',
      ]
    : [
        'Remove any existing A, AAAA or CNAME record for this exact name first; a name can only have one CNAME.',
      ];
  notes.push(
    'DNS changes can take from a few minutes up to 48 hours to propagate. Keep the TXT record in place.',
    'HTTPS certificates are issued automatically by the hosting platform once the domain points at it; there is nothing to upload.',
  );

  return {
    isApex,
    records: [
      routing,
      {
        type: 'TXT',
        name: verificationRecordName(domain),
        value: verificationToken,
        purpose: 'verification',
      },
    ],
    notes,
  };
}

export type TxtLookupOutcome =
  | { kind: 'records'; records: string[][] }
  | { kind: 'error'; code?: string; message?: string };

export type VerifyFailure = {
  verified: false;
  reason: 'record_not_found' | 'token_mismatch' | 'dns_error';
  message: string;
  found?: string[];
};

/** Turns a raw TXT lookup into either success or a precise failure reason. */
export function classifyTxtLookup(
  domain: string,
  token: string,
  outcome: TxtLookupOutcome,
): { verified: true } | VerifyFailure {
  const name = verificationRecordName(domain);

  if (outcome.kind === 'error') {
    if (outcome.code === 'ENOTFOUND' || outcome.code === 'ENODATA') {
      return {
        verified: false,
        reason: 'record_not_found',
        message: `No TXT record exists at ${name} yet. Add it at your DNS provider and try again after it propagates.`,
      };
    }
    return {
      verified: false,
      reason: 'dns_error',
      message: `DNS lookup for ${name} failed (${outcome.code ?? outcome.message ?? 'unknown error'}). Try again in a minute.`,
    };
  }

  const values = outcome.records.map((chunks) => chunks.join(''));
  if (values.some((value) => value.includes(token))) return { verified: true };

  if (values.length === 0) {
    return {
      verified: false,
      reason: 'record_not_found',
      message: `No TXT record exists at ${name} yet.`,
    };
  }

  return {
    verified: false,
    reason: 'token_mismatch',
    message: `A TXT record exists at ${name} but its value does not match the verification token. Check for typos or an old token, then try again.`,
    found: values.slice(0, 3).map((value) => value.slice(0, 80)),
  };
}
