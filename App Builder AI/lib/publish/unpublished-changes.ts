const TOLERANCE_MS = 2000;

/** True when something was saved after the live version was published. */
export function hasUnpublishedChanges({
  publishedAt,
  fileUpdatedAts,
  lastSavedAt,
}: {
  publishedAt: string | null | undefined;
  fileUpdatedAts: string[];
  lastSavedAt?: Date | null;
}): boolean {
  if (!publishedAt) return false;
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return false;
  const cutoff = published + TOLERANCE_MS;

  if (lastSavedAt && lastSavedAt.getTime() > cutoff) return true;
  return fileUpdatedAts.some((value) => new Date(value).getTime() > cutoff);
}
