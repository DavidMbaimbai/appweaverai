import { describe, expect, it } from 'vitest';
import { hasUnpublishedChanges } from './unpublished-changes';

const published = '2026-10-11T10:00:00.000Z';

describe('hasUnpublishedChanges', () => {
  it('is false when never published', () => {
    expect(
      hasUnpublishedChanges({ publishedAt: null, fileUpdatedAts: [published] }),
    ).toBe(false);
  });

  it('is false when files were not touched after publishing', () => {
    expect(
      hasUnpublishedChanges({
        publishedAt: published,
        fileUpdatedAts: ['2026-10-11T09:00:00.000Z', '2026-10-11T10:00:01.000Z'],
      }),
    ).toBe(false);
  });

  it('is true when a file changed after publishing', () => {
    expect(
      hasUnpublishedChanges({
        publishedAt: published,
        fileUpdatedAts: ['2026-10-11T10:05:00.000Z'],
      }),
    ).toBe(true);
  });

  it('is true when something was saved in this session after publishing', () => {
    expect(
      hasUnpublishedChanges({
        publishedAt: published,
        fileUpdatedAts: [],
        lastSavedAt: new Date('2026-10-11T10:10:00.000Z'),
      }),
    ).toBe(true);
  });
});
