import { describe, expect, it } from 'vitest';

import {
  fromDeploymentVisibility,
  publishedPath,
  toDeploymentVisibility,
  type PublishVisibility,
} from '@/lib/publish/visibility';

describe('toDeploymentVisibility / fromDeploymentVisibility', () => {
  const cases: Array<[PublishVisibility, string]> = [
    ['private', 'PRIVATE'],
    ['workspace', 'WORKSPACE_ONLY'],
    ['public', 'PUBLIC'],
  ];

  it.each(cases)('maps %s <-> %s round-trip', (visibility, dbValue) => {
    expect(toDeploymentVisibility(visibility)).toBe(dbValue);
    expect(fromDeploymentVisibility(dbValue as never)).toBe(visibility);
  });
});

describe('publishedPath', () => {
  it('builds a /p/<workspace>/<project> path', () => {
    expect(publishedPath('acme', 'my-app')).toBe('/p/acme/my-app');
  });
});
