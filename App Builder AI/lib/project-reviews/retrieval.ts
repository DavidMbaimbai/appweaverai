export type KnowledgeDoc = { id: string; title: string; content: string };

const STOP = new Set(
  'a an and are as at be but by can do does for from have how i if in is it its my of on or our so that the their there this to was we what when where which who why will with you your'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/** BM25 ranking over title+content. Returns only docs sharing at least one query term. */
export function searchKnowledge(
  query: string,
  docs: KnowledgeDoc[],
  limit = 4,
): Array<KnowledgeDoc & { score: number }> {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !docs.length) return [];

  const k1 = 1.5;
  const b = 0.75;
  const tokenized = docs.map((d) => tokenize(`${d.title} ${d.title} ${d.content}`));
  const avgLen = tokenized.reduce((s, t) => s + t.length, 0) / docs.length || 1;

  const scored = docs.map((doc, i) => {
    const tokens = tokenized[i];
    let score = 0;
    for (const term of terms) {
      const tf = tokens.filter((t) => t === term).length;
      if (!tf) continue;
      const df = tokenized.filter((t) => t.includes(term)).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens.length) / avgLen));
    }
    return { ...doc, score };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);
}
