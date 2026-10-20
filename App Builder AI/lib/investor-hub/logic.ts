import { normalizeEmail } from '@/lib/outreach/compliance';

import { PIPELINE_STAGES, type PipelineStage, type ReplyClass } from './constants';

/** Lowercased host without "www." for duplicate detection; null for unusable input. */
export function normalizeDomain(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

export function emailKey(email: string | null | undefined): string | null {
  const value = email?.trim();
  return value ? normalizeEmail(value) : null;
}

export function stageRank(stage: PipelineStage) {
  return PIPELINE_STAGES.indexOf(stage);
}

/** Moves forward only (never back), never out of FUNDING_SECURED/DECLINED unless asked explicitly. */
export function advanceStage(current: PipelineStage, target: PipelineStage): PipelineStage {
  if (current === 'FUNDING_SECURED' || current === 'DECLINED') return current;
  if (target === 'DECLINED') return target;
  return stageRank(target) > stageRank(current) ? target : current;
}

const RULES: Array<[ReplyClass, RegExp]> = [
  [
    'unsubscribe',
    /\b(unsubscribe|opt[\s-]?out|remove me|stop (emailing|contacting|sending)|do not (contact|email)|don'?t (contact|email) me|take me off)\b/i,
  ],
  ['wrong_contact', /\b(wrong (person|contact|address)|not the right (person|contact)|no longer (at|with)|left the (firm|company)|try (reaching|contacting))\b/i],
  ['not_interested', /\b(not interested|no thanks|not a (good )?fit|we('ll| will)? pass|i('ll| will)? pass|decline|not investing|outside (of )?our (focus|mandate|thesis))\b/i],
  ['deck_requested', /\b(pitch deck|send (over )?(the |your )?(deck|slides|materials)|share (the |your )?deck|one[\s-]?pager)\b|\bdeck\b/i],
  ['meeting_requested', /\b(schedule|book|set up|calendly|zoom|google meet|free (for|to) (a )?(call|chat|meet)|let'?s (talk|chat|meet|connect)|hop on a call|available (on|for))\b/i],
  ['more_info', /\b(more (info|information|details)|tell me more|can you (share|send|clarify)|few questions|what (is|are) your)\b/i],
  ['interested', /\b(interested|sounds (great|interesting|good)|intrigued|love to learn|keen)\b/i],
  ['follow_up', /\b(follow[\s-]?up|circle back|reach out (again )?(later|in)|next (quarter|month)|not right now|bad timing|keep me posted)\b/i],
];

/** Keyword classification; unsubscribe always wins. Returns null when nothing matches. */
export function classifyReplyHeuristic(text: string): ReplyClass | null {
  for (const [label, pattern] of RULES) if (pattern.test(text)) return label;
  return null;
}

export type ReplyEffect = {
  stage: PipelineStage | null;
  stopSequence: boolean;
  optOut: boolean;
};

export function replyEffect(label: ReplyClass): ReplyEffect {
  switch (label) {
    case 'unsubscribe':
      return { stage: 'DECLINED', stopSequence: true, optOut: true };
    case 'not_interested':
      return { stage: 'DECLINED', stopSequence: true, optOut: false };
    default:
      return { stage: 'REPLIED', stopSequence: true, optOut: false };
  }
}
