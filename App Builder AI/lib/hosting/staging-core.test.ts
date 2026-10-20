import { describe, expect, it } from 'vitest';

import {
  decideStagingAccess,
  generateStagingToken,
  planPromotion,
} from './staging-core';
import {
  extractStagingLabel,
  extractSubdomainLabel,
  stagingHost,
  validateSubdomain,
} from '../domains/subdomain';

describe('staging host parsing', () => {
  it('round-trips a staging host', () => {
    expect(stagingHost('my-app', 'example.com')).toBe('my-app--staging.example.com');
    expect(extractStagingLabel('my-app--staging.example.com:3000', 'example.com')).toBe('my-app');
  });

  it.each([
    'my-app.example.com',
    '--staging.example.com',
    'my-app--staging.other.com',
    'www--staging.example.com',
    'a.b--staging.example.com',
    'my-app--staging.example.com.evil.com',
  ])('does not treat %s as staging', (host) => {
    expect(extractStagingLabel(host, 'example.com')).toBeNull();
  });

  it('keeps staging labels out of the production subdomain space', () => {
    expect(extractSubdomainLabel('my-app--staging.example.com', 'example.com')).toBeNull();
    expect(validateSubdomain('my-app--staging').ok).toBe(false);
  });
});

describe('decideStagingAccess', () => {
  const token = generateStagingToken();
  const base = { deploymentToken: token, isMember: false };

  it('allows members and open links', () => {
    expect(decideStagingAccess({ ...base, isMember: true }).allowed).toBe(true);
    expect(decideStagingAccess({ deploymentToken: null, isMember: false }).allowed).toBe(true);
  });

  it('requires a matching query or cookie token otherwise', () => {
    expect(decideStagingAccess(base).allowed).toBe(false);
    expect(decideStagingAccess({ ...base, queryToken: 'nope' }).allowed).toBe(false);
    expect(decideStagingAccess({ ...base, queryToken: token })).toEqual({ allowed: true, via: 'query' });
    expect(decideStagingAccess({ ...base, cookieToken: token })).toEqual({ allowed: true, via: 'cookie' });
  });
});

describe('planPromotion', () => {
  const staging = { version: 7, visibility: 'PRIVATE' };
  const input = {
    staging,
    production: { version: 5, visibility: 'PUBLIC', promotedFromVersion: null },
    latestVersion: 7,
    stagingSnapshotExists: true,
    productionVisibility: 'PUBLIC',
  };

  it('copies the staging version into a new production version', () => {
    expect(planPromotion(input)).toEqual({
      ok: true,
      newVersion: 8,
      sourceVersion: 7,
      visibility: 'PUBLIC',
    });
  });

  it('refuses without staging, without stored files, or when already promoted', () => {
    expect(planPromotion({ ...input, staging: null }).ok).toBe(false);
    expect(planPromotion({ ...input, stagingSnapshotExists: false }).ok).toBe(false);
    const again = planPromotion({
      ...input,
      production: { version: 8, visibility: 'PUBLIC', promotedFromVersion: 7 },
    });
    expect(again).toMatchObject({ ok: false });
  });
});
