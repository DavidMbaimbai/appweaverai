import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison (length differences still short-circuit, which leaks nothing secret). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
