import { describe, expect, it } from 'vitest';

import { signDownloadToken, verifyDownloadToken } from './export';
import { erasedEmailFor, hashEmail, hashPhone, isErasedEmail, isHashedKey, normalizeEmailAddress } from './identifiers';
import { slaState } from './requests';
import { stripSecrets } from './user-data';

describe('identifier hashing', () => {
  it('is stable across case/whitespace and never contains the address', () => {
    const hash = hashEmail('  Jane@Example.COM ');
    expect(hash).toBe(hashEmail('jane@example.com'));
    expect(isHashedKey(hash)).toBe(true);
    expect(hash).not.toContain('jane');
    expect(hashEmail('other@example.com')).not.toBe(hash);
  });

  it('hashes phones by digits only and namespaces them away from emails', () => {
    expect(hashPhone('+27 82 555 0101')).toBe(hashPhone('27825550101'));
    expect(hashPhone('27825550101')).not.toBe(hashEmail('27825550101'));
  });

  it('recognises erased placeholder addresses', () => {
    expect(isErasedEmail(erasedEmailFor('u1'))).toBe(true);
    expect(isErasedEmail('a@b.test')).toBe(false);
    expect(normalizeEmailAddress(' A@B.test ')).toBe('a@b.test');
  });
});

describe('download tokens', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('round-trips and expires after 15 minutes', () => {
    const token = signDownloadToken('job1', now);
    expect(verifyDownloadToken(token, new Date(now.getTime() + 60_000))).toBe('job1');
    expect(verifyDownloadToken(token, new Date(now.getTime() + 16 * 60_000))).toBeNull();
  });

  it('rejects tampering', () => {
    const [payload, signature] = signDownloadToken('job1', now).split('.');
    const forged = `${Buffer.from(Buffer.from(payload, 'base64url').toString().replace('job1', 'job2')).toString('base64url')}.${signature}`;
    expect(verifyDownloadToken(forged, now)).toBeNull();
    expect(verifyDownloadToken('garbage', now)).toBeNull();
    expect(verifyDownloadToken('', now)).toBeNull();
  });
});

describe('request SLA', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const due = (days: number) => new Date(now.getTime() + days * 86_400_000);

  it('classifies open requests by days left', () => {
    expect(slaState({ status: 'OPEN', dueAt: due(20) }, now).state).toBe('ON_TRACK');
    expect(slaState({ status: 'OPEN', dueAt: due(4) }, now).state).toBe('DUE_SOON');
    expect(slaState({ status: 'IN_PROGRESS', dueAt: due(-2) }, now)).toEqual({ state: 'OVERDUE', daysLeft: -2 });
    expect(slaState({ status: 'PENDING_VERIFICATION', dueAt: null }, now).state).toBe('NOT_STARTED');
    expect(slaState({ status: 'COMPLETED', dueAt: due(-10) }, now).state).toBe('CLOSED');
  });
});

describe('stripSecrets', () => {
  it('removes credentials but keeps ordinary data', () => {
    const out = stripSecrets({ email: 'a@b.test', accessToken: 'x', password: 'p', nested: [{ refreshTokenEnc: 'y', name: 'n' }] });
    expect(JSON.stringify(out)).not.toMatch(/"x"|"p"|"y"/);
    expect(JSON.stringify(out)).toContain('a@b.test');
    expect(JSON.stringify(out)).toContain('"n"');
  });
});
