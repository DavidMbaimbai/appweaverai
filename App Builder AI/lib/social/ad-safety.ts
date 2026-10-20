const BANNED =
  /\b(guarantee[sd]?|#1|number one|best in|award[- ]winning|risk[- ]free|invest(?:ment|or|ors)?|fundrais\w*|valuation|\d+\s?%|\d[\d,]*\+?\s+(?:users|customers|apps))\b/i;

export function isSafeAdText(text: string) {
  return !BANNED.test(text);
}
