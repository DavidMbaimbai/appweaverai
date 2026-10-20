import { buildUntrustedCall } from '@/lib/agents/untrusted';
import { getAnthropicClient } from '@/lib/anthropic';
import { prisma } from '@/lib/prisma';
import type { KnowledgeDoc } from '@/lib/project-reviews/retrieval';

import { ALL_CATEGORIES } from './types';

export const INBOX_MODEL =
  process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

export type HistoryItem = { direction: 'INBOUND' | 'OUTBOUND'; body: string };

export type Analysis = {
  language: string | null;
  category: string | null;
  summary: string | null;
  lead: { name: string | null; email: string | null; phone: string | null } | null;
  flags: string[];
};

export type DraftResult = {
  answer: string | null;
  /** 1-based indexes of the knowledge entries the answer relies on. */
  sourceIndexes: number[];
  confidence: number;
  conflict: boolean;
  flags: string[];
};

const ANALYSIS_SYSTEM = `You classify an incoming customer message for a business inbox.
Respond with ONLY JSON: {"language": "<ISO 639-1 code>", "category": one of ${ALL_CATEGORIES.join('|')}, "summary": "<one neutral sentence, max 200 chars>", "lead": {"name": string|null, "email": string|null, "phone": string|null}|null}
Category guide: product_info, pricing (published prices), docs, hours, booking (wants an appointment or demo), lead_qualification (interested in buying or working together), troubleshooting, faq; complaint, refund, legal, security, payment (billing or payment problems), account_change, commitment (wants a guarantee or contract), pricing_exception (discount or special price); other.
If unsure whether a message is a complaint, refund, legal, security or payment matter, choose that sensitive category. "lead" only contains details the customer wrote themselves, otherwise null.`;

const DRAFT_SYSTEM = `You write the reply to a customer message on behalf of a business. Use ONLY the entries inside <knowledge>.
- If the answer is not clearly and consistently stated there, return {"answer": null}. If entries contradict each other, return {"answer": null, "conflict": true}.
- Never invent prices, policies, availability, dates or features. Never promise refunds, discounts, deadlines, outcomes or actions. Never include links.
- You cannot access accounts or orders and cannot perform actions. Never ask for passwords or payment details.
- Short, friendly, plain text, in the customer's language.
Respond with ONLY JSON: {"answer": string|null, "sources": [<1-based knowledge entry numbers used>], "confidence": <0-1>, "conflict": <true|false>}`;

const parseJson = (raw: string) => {
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw) as Record<string, unknown>;
};

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function parseAnalysis(raw: string): Omit<Analysis, 'flags'> {
  try {
    const p = parseJson(raw);
    const lead = p.lead && typeof p.lead === 'object' ? (p.lead as Record<string, unknown>) : null;
    return {
      language: str(p.language, 5)?.toLowerCase() ?? null,
      category: typeof p.category === 'string' && (ALL_CATEGORIES as readonly string[]).includes(p.category) ? p.category : null,
      summary: str(p.summary, 300),
      lead: lead ? { name: str(lead.name, 120), email: str(lead.email, 254), phone: str(lead.phone, 40) } : null,
    };
  } catch {
    return { language: null, category: null, summary: null, lead: null };
  }
}

export function parseDraft(raw: string): Omit<DraftResult, 'flags'> {
  try {
    const p = parseJson(raw);
    const confidence = typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1 ? p.confidence : 0;
    return {
      answer: str(p.answer, 1500),
      sourceIndexes: Array.isArray(p.sources) ? p.sources.filter((n): n is number => Number.isInteger(n)) : [],
      confidence,
      conflict: p.conflict === true,
    };
  } catch {
    return { answer: null, sourceIndexes: [], confidence: 0, conflict: false };
  }
}

async function complete(call: { system: string; messages: Array<{ role: 'user'; content: string }> }, scopeProjectId: string | null, maxTokens: number) {
  const started = Date.now();
  const response = await getAnthropicClient().messages.create({
    model: INBOX_MODEL,
    max_tokens: maxTokens,
    system: call.system,
    messages: call.messages,
  });
  const block = response.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Model returned no text.');
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  await prisma.aiUsageEvent
    .create({
      data: {
        projectId: scopeProjectId ?? undefined,
        provider: 'unified-inbox',
        model: INBOX_MODEL,
        inputTokens,
        outputTokens,
        estimatedCostCents: Math.round((inputTokens / 1e6) * 300 + (outputTokens / 1e6) * 1500),
        latencyMs: Date.now() - started,
        status: 'SUCCESS',
      },
    })
    .catch(() => null);
  return block.text;
}

const historyText = (history: HistoryItem[]) =>
  history.map((h) => `${h.direction === 'INBOUND' ? 'Customer' : 'Business'}: ${h.body}`).join('\n').slice(-3000);

export async function analyzeMessage(input: { projectId: string | null; text: string; history: HistoryItem[] }): Promise<Analysis> {
  const call = buildUntrustedCall({
    system: ANALYSIS_SYSTEM,
    task: 'Classify the latest customer message.',
    untrusted: [
      { label: 'history', content: historyText(input.history) || '(none)', redact: true, maxLength: 3000 },
      { label: 'customer_message', content: input.text, redact: true, maxLength: 2000 },
    ],
  });
  const parsed = parseAnalysis(await complete(call, input.projectId, 400));
  return { ...parsed, flags: call.flags };
}

export async function draftAnswer(input: {
  projectId: string | null;
  text: string;
  history: HistoryItem[];
  language: string | null;
  hits: KnowledgeDoc[];
}): Promise<DraftResult> {
  const knowledge = input.hits.map((d, i) => `[${i + 1}] ${d.title}\n${d.content.slice(0, 1500)}`).join('\n\n');
  const call = buildUntrustedCall({
    system: DRAFT_SYSTEM,
    task: `Reply language: ${input.language ?? 'same as the customer'}.`,
    untrusted: [
      { label: 'knowledge', content: knowledge, maxLength: 7000 },
      { label: 'history', content: historyText(input.history) || '(none)', redact: true, maxLength: 3000 },
      { label: 'customer_message', content: input.text, redact: true, maxLength: 2000 },
    ],
  });
  const parsed = parseDraft(await complete(call, input.projectId, 700));
  return { ...parsed, flags: call.flags };
}
