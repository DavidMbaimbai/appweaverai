/** Clear a previous OAuth failure without losing the intended destination. */
export function clearSignInErrorUrl(url: URL) {
  const clean = new URL(url);
  for (const key of ['error', 'error_description', 'code', 'state', 'token']) {
    clean.searchParams.delete(key);
  }
  return `${clean.pathname}${clean.search}${clean.hash}`;
}
