const BANNED =
  /\b(guarantee[sd]?|#1|number one|best in|award[- ]winning|risk[- ]free|invest(?:ment|or|ors)?|fundrais\w*|valuation|\d+\s?%|\d[\d,]*\+?\s+(?:users|customers|apps)|cures?|treats?|instant|overnight|passive income|get rich|easier than|better than|cheaper than|competitor|official|lose \d+ lbs|cure cancer|make \$\d+|earn \$\d+|work from home|no experience needed|secret formula|miracle|magic|once in a lifetime|don't miss out|limited time only|hurry|act now|call now|order now|buy now|get it now|free gift|win a free|you've won|congratulations)\b/i;

export function isSafeAdText(text: string) {
  return !BANNED.test(text);
}
