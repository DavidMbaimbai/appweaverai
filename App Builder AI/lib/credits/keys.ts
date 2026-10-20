/** Ledger key of the charge made when a video job is created (job.idempotencyKey is the input). */
export function videoChargeKey(jobIdempotencyKey: string) {
  return `video:${jobIdempotencyKey}`;
}
