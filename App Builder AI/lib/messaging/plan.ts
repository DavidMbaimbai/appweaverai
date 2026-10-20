import { isLowRiskCategory, isSensitiveCategory, type MessageCategory } from './types';

/** Most severe first: when several patterns match, the earliest wins. */
const SENSITIVE_PATTERNS: Array<{ category: MessageCategory; pattern: RegExp }> = [
  { category: 'legal', pattern: /\b(lawyer|attorney|solicitor|lawsuit|sue\b|suing|court|legal action|gdpr|data protection|subpoena|defamation|copyright claim)\b/i },
  { category: 'security', pattern: /\b(hack(ed|er)?|breach|vulnerabilit|security (issue|bug|hole)|data leak|leaked|stolen|phishing|exploit|unauthori[sz]ed access|compromised)\b/i },
  { category: 'refund', pattern: /\b(refund|chargeback|money back|reimburse|compensat|cancel (my )?(order|payment))\b/i },
  { category: 'payment', pattern: /\b(charged (me )?(twice|again|wrong)|double charge|payment (failed|issue|problem|declined)|card (was )?declined|invoice (dispute|wrong)|billing (issue|problem|error))\b/i },
  { category: 'account_change', pattern: /\b(delete my (account|data)|close my account|change (my )?(email|password|plan|owner)|transfer (the )?(account|ownership)|cancel my (subscription|plan|account)|reset my password|remove my data)\b/i },
  { category: 'commitment', pattern: /\b(guarantee|promise me|in writing|contract|sla\b|binding|legally|warranty)\b/i },
  { category: 'pricing_exception', pattern: /\b(discount|coupon|promo code|special (price|rate|deal)|custom (price|pricing)|negotiat|waive|price match|cheaper for me)\b/i },
  { category: 'complaint', pattern: /\b(complain|unacceptable|terrible|awful|worst|furious|angry|disappointed|scam|fraud|rip[- ]?off|disgusting|useless)\b/i },
];

/** Deterministic sensitivity check on the raw message; the model can only make this stricter, never looser. */
export function classifyHeuristic(text: string): MessageCategory | null {
  for (const { category, pattern } of SENSITIVE_PATTERNS) if (pattern.test(text)) return category;
  return null;
}

const SEVERITY: MessageCategory[] = ['legal', 'security', 'refund', 'payment', 'account_change', 'commitment', 'pricing_exception', 'complaint', 'review'];

/** Final category: reviews and anything sensitive (by rule or by the model) win over a benign model label. */
export function resolveCategory(input: { modelCategory: string | null; heuristic: MessageCategory | null; isReview: boolean }): MessageCategory {
  if (input.isReview) return 'review';
  const model = input.modelCategory as MessageCategory | null;
  const candidates = [input.heuristic, model && isSensitiveCategory(model) ? model : null].filter(Boolean) as MessageCategory[];
  if (candidates.length) return candidates.sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0];
  if (model && (isLowRiskCategory(model) || model === 'other')) return model;
  return 'other';
}

/** Every number (price, date, quantity) in the answer must literally appear in the cited sources. */
export function answerGrounded(answer: string, sources: readonly string[]): boolean {
  const haystack = sources.join('\n').replace(/[,\s]/g, '');
  const numbers = answer.match(/\d[\d.,]*/g) ?? [];
  return numbers.every((n) => haystack.includes(n.replace(/[,\s]/g, '').replace(/[.,]$/, '')));
}

export type PlanInput = {
  category: MessageCategory;
  isReview: boolean;
  /** Injection patterns found in the customer's message; they only ever make the outcome stricter. */
  injectionFlags: readonly string[];
  /** Verified answer text, or null when the knowledge does not cover the question / sources conflict. */
  answer: string | null;
  humanTakeover?: boolean;
};

export type ResponsePlan = {
  kind: 'ANSWER' | 'HANDOFF' | 'NONE';
  /** May be sent without a human only if the owner also allowed autonomous customer replies (decided by decide()). */
  autoSendAllowed: boolean;
  escalate: boolean;
  reasons: string[];
};

export function planResponse(input: PlanInput): ResponsePlan {
  if (input.humanTakeover) return { kind: 'NONE', autoSendAllowed: false, escalate: false, reasons: ['Human takeover is on.'] };

  const reasons: string[] = [];
  const sensitive = input.isReview || isSensitiveCategory(input.category);
  if (input.isReview) reasons.push('Reviews are never answered automatically.');
  else if (sensitive) reasons.push(`Sensitive category "${input.category}" needs a human.`);
  if (input.injectionFlags.length) reasons.push(`Message contains instruction-like text (${input.injectionFlags.join(', ')}).`);

  const kind = input.answer ? 'ANSWER' : 'HANDOFF';
  if (!input.answer) reasons.push('No verified answer in the knowledge base; passing to the team.');

  const strict = sensitive || input.injectionFlags.length > 0;
  const autoSendAllowed = !strict && (kind === 'HANDOFF' || isLowRiskCategory(input.category));
  if (!strict && kind === 'ANSWER' && !isLowRiskCategory(input.category)) reasons.push('Category is not on the low-risk list.');
  return { kind, autoSendAllowed, escalate: sensitive || kind === 'HANDOFF', reasons };
}

export type Route = {
  action: 'messaging.reply.send' | 'messaging.reply.draft';
  category: string;
  kinds: string[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
};

const KINDS: Partial<Record<MessageCategory, string[]>> = {
  refund: ['refund'],
  payment: ['sensitive_data_change'],
  account_change: ['sensitive_data_change', 'permission_change'],
  commitment: ['binding_commitment'],
  pricing_exception: ['binding_commitment'],
};

/**
 * What to hand to runAgentAction. Only an auto-send-allowed plan uses the "customer_reply" category (the one an owner can
 * allow to run autonomously); everything else uses a draft action in a category no owner setting can match, with high risk
 * for sensitive categories so decide() can never return EXECUTE for it.
 */
export function routeFor(plan: ResponsePlan, category: MessageCategory, isReview: boolean): Route {
  if (plan.autoSendAllowed) return { action: 'messaging.reply.send', category: 'customer_reply', kinds: [], risk: 'LOW' };
  if (isReview) return { action: 'messaging.reply.draft', category: 'review_reply', kinds: [], risk: 'HIGH' };
  const sensitive = isSensitiveCategory(category);
  return {
    action: 'messaging.reply.draft',
    category: 'inbox_hold',
    kinds: KINDS[category] ?? [],
    risk: sensitive ? 'HIGH' : 'MEDIUM',
  };
}

const HANDOFF: Record<string, string> = {
  en: "Thanks for your message. I don't have verified information on that, so I'll pass your question to the team and they will get back to you.",
  de: 'Danke für Ihre Nachricht. Dazu habe ich keine gesicherten Informationen, daher gebe ich Ihre Frage an das Team weiter, das sich bei Ihnen meldet.',
  fr: "Merci pour votre message. Je n'ai pas d'information fiable à ce sujet, je transmets donc votre question à l'équipe qui reviendra vers vous.",
  es: 'Gracias por tu mensaje. No tengo información verificada sobre eso, así que pasaré tu pregunta al equipo y te responderán.',
  it: 'Grazie per il messaggio. Non ho informazioni verificate su questo, quindi passo la tua domanda al team che ti risponderà.',
  pt: 'Obrigado pela mensagem. Não tenho informações confirmadas sobre isso, por isso vou passar a sua pergunta à equipa, que entrará em contacto.',
  nl: 'Bedankt voor je bericht. Hierover heb ik geen geverifieerde informatie, dus ik geef je vraag door aan het team dat bij je terugkomt.',
};

/** Fixed hand-off text (no model output), so an injected message can never shape what gets sent. */
export function handoffMessage(language: string | null | undefined): string {
  const code = (language ?? 'en').toLowerCase().slice(0, 2);
  return HANDOFF[code] ?? HANDOFF.en;
}
