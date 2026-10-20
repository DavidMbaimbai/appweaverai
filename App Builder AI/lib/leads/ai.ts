import { getAnthropicClient } from '@/lib/anthropic';

import { basicScore, buildQualificationInput, parseQualification, type QualifiableLead, type Qualification } from './logic';

const MODEL = process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

async function ask(system: string, user: string, maxTokens: number) {
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

const QUALIFY_SYSTEM = `You qualify a sales lead for a small business using ONLY the fields in the JSON the user provides.
Rules:
- Never infer or invent company size, budget, job title, location, intent or any fact that is not in a provided field.
- A missing field is unknown, not negative. Say what is unknown in a reason when it matters.
- Score 0-100 = how well the PROVIDED information suggests a follow-up is worthwhile (0 = nothing useful, 100 = explicit buying intent with contact details).
- Each reason must reference a provided field (e.g. "notes mention a demo request").
Return ONLY JSON: {"score": 0-100, "reasons": ["..."], "nextAction": "one short suggested next step for the owner"}`;

export async function qualifyLead(lead: QualifiableLead): Promise<Qualification & { usedAi: boolean }> {
  const input = buildQualificationInput(lead);
  try {
    const parsed = parseQualification(await ask(QUALIFY_SYSTEM, JSON.stringify(input), 600));
    if (parsed) return { ...parsed, usedAi: true };
  } catch (error) {
    console.error('[leads] qualification failed:', error);
  }
  return { ...basicScore(input), usedAi: false };
}

const DRAFT_SYSTEM = `You draft a short, friendly follow-up email from a small business to one of its leads, using ONLY the facts provided.
Rules:
- Never invent prices, discounts, availability, guarantees, product features, customer numbers or promises. If asked-for detail is missing, invite a reply instead.
- Use only the lead's name and the facts under "lead" and "business". Do not mention data we do not hold.
- Under 120 words, plain text, no placeholders, no links, no unsubscribe line (appended automatically), sign off with the business name.
Return ONLY JSON: {"subject": "...", "body": "..."}`;

export function parseDraft(raw: string): { subject: string; body: string } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const subject = typeof parsed.subject === 'string' ? parsed.subject.trim().slice(0, 150) : '';
    const body = typeof parsed.body === 'string' ? parsed.body.trim().slice(0, 3000) : '';
    if (!subject || !body || /https?:\/\//i.test(body) || /\[[^\]]+\]/.test(body)) return null;
    return { subject, body };
  } catch {
    return null;
  }
}

export async function draftFollowUp(lead: QualifiableLead, business: { name: string; description: string | null }) {
  const input = buildQualificationInput(lead);
  delete input.email;
  const payload = { business: { name: business.name, description: business.description?.slice(0, 600) || undefined }, lead: input };
  try {
    return parseDraft(await ask(DRAFT_SYSTEM, JSON.stringify(payload), 700));
  } catch (error) {
    console.error('[leads] draft failed:', error);
    return null;
  }
}
