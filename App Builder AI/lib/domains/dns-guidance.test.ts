import { describe, expect, it } from 'vitest';

import {
  classifyTxtLookup,
  getDnsGuidance,
  isApexDomain,
} from './dns-guidance';

const targets = { cname: 'cname.example.net', a: '203.0.113.1' };

describe('isApexDomain', () => {
  it('detects apex vs subdomain, including multi-part suffixes', () => {
    expect(isApexDomain('example.com')).toBe(true);
    expect(isApexDomain('www.example.com')).toBe(false);
    expect(isApexDomain('example.co.uk')).toBe(true);
    expect(isApexDomain('app.example.co.uk')).toBe(false);
  });
});

describe('getDnsGuidance', () => {
  it('uses CNAME for subdomains and A for apex, plus TXT', () => {
    const sub = getDnsGuidance('app.example.com', 'tok', targets);
    expect(sub.records[0]).toMatchObject({ type: 'CNAME', value: 'cname.example.net' });
    expect(sub.records[1]).toMatchObject({
      type: 'TXT',
      name: '_appweaverai-verify.app.example.com',
      value: 'tok',
    });

    const apex = getDnsGuidance('example.com', 'tok', targets);
    expect(apex.records[0]).toMatchObject({ type: 'A', value: '203.0.113.1' });
  });
});

describe('classifyTxtLookup', () => {
  it('verifies when a (chunked) record contains the token', () => {
    expect(
      classifyTxtLookup('a.com', 'abc123', { kind: 'records', records: [['ab', 'c123']] }),
    ).toEqual({ verified: true });
  });

  it('reports a missing record', () => {
    const result = classifyTxtLookup('a.com', 'abc', { kind: 'error', code: 'ENODATA' });
    expect(result).toMatchObject({ verified: false, reason: 'record_not_found' });
  });

  it('reports a token mismatch with what was found', () => {
    const result = classifyTxtLookup('a.com', 'abc', {
      kind: 'records',
      records: [['other']],
    });
    expect(result).toMatchObject({ reason: 'token_mismatch', found: ['other'] });
  });

  it('reports other DNS errors', () => {
    const result = classifyTxtLookup('a.com', 'abc', { kind: 'error', code: 'ETIMEOUT' });
    expect(result).toMatchObject({ reason: 'dns_error' });
  });
});
