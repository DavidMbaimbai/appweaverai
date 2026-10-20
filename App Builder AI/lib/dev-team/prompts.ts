import { buildUntrustedCall, type SafeModelCall } from '@/lib/agents/untrusted';

import { describeScope } from './permissions';
import { DEV_TEAM_ROLE_LABELS, type DevTeamRoleName } from './types';

const CHARS_PER_TOKEN = 4;

export const approxTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

function clip(text: string, tokens: number) {
  const max = tokens * CHARS_PER_TOKEN;
  return text.length > max ? `${text.slice(0, Math.max(0, max - 20))}\n[truncated]` : text;
}

export type DependencyOutput = { key: string; role: DevTeamRoleName; title: string; summary: string; messages: string[] };
export type FileForPrompt = { path: string; content: string; editable: boolean };
export type TeamMessage = { role: DevTeamRoleName | null; text: string };

export const TASK_OUTPUT_FORMAT = [
  'Reply with ONE JSON object and nothing else:',
  '{"summary": "<what you did, max 600 chars>",',
  ' "messages": ["<short notes for the rest of the team, max 5>"],',
  ' "changes": [{"path": "<project-relative path>", "op": "CREATE|MODIFY|DELETE", "content": "<the COMPLETE new file content; omit for DELETE>", "rationale": "<why>"}]}',
  'Rules: only change files inside your scope; MODIFY only files shown to you as editable and return the whole file; keep changes minimal; never include secrets, keys or credentials; use [] for changes if you have none.',
].join('\n');

export function roleSystemPrompt(role: DevTeamRoleName): string {
  const info = DEV_TEAM_ROLE_LABELS[role];
  return [
    `You are the ${info.label} on an AI development team improving a customer's web app. ${info.description}`,
    `Your file scope: ${describeScope(role)}`,
    'You cannot apply, publish or deploy anything, send messages to anyone, or spend money. You only propose file changes; a person reviews and approves them.',
    role === 'TESTING' || role === 'SECURITY'
      ? 'You are a read-only reviewer: put every finding in "messages" and "summary" (with file and line when known) and return "changes": [].'
      : 'Coordinate through "messages": say what other roles need to know (interfaces, names, assumptions).',
  ].join('\n');
}

/**
 * Builds one role's model call. Trusted text (task, goal, role rules) is kept apart from everything derived
 * from project files, project memory or other roles' output, which is wrapped as untrusted data.
 */
export function buildTaskCall(args: {
  role: DevTeamRoleName;
  goal: string;
  task: { key: string; title: string; description: string };
  brief: string;
  dependencies: DependencyOutput[];
  files: FileForPrompt[];
  team: TeamMessage[];
  contextTokenBudget: number;
  dependencyTokenBudget: number;
}): SafeModelCall & { tokenEstimate: number; omittedFiles: string[] } {
  let remaining = args.contextTokenBudget;
  const take = (text: string, cap: number) => {
    const clipped = clip(text, Math.min(cap, Math.max(0, remaining)));
    remaining -= approxTokens(clipped);
    return clipped;
  };

  const untrusted: Array<{ label: string; content: string; redact?: boolean; maxLength?: number }> = [];

  const brief = args.brief ? take(args.brief, Math.floor(args.contextTokenBudget * 0.2)) : '';
  if (brief) untrusted.push({ label: 'projectbrief', content: brief, redact: true, maxLength: brief.length + 40 });

  for (const dep of args.dependencies) {
    const text = take(
      [`Task ${dep.key} (${dep.role}): ${dep.title}`, `Summary: ${dep.summary}`, ...dep.messages.map((m) => `Note: ${m}`)].join('\n'),
      args.dependencyTokenBudget,
    );
    if (text) untrusted.push({ label: `dep${dep.key}`.replace(/[^a-z0-9]/gi, ''), content: text, redact: true, maxLength: text.length + 40 });
  }

  const log = args.team.slice(-12).map((m) => `[${m.role ?? 'SYSTEM'}] ${m.text}`).join('\n');
  if (log) {
    const text = take(log, Math.floor(args.contextTokenBudget * 0.1));
    if (text) untrusted.push({ label: 'teamlog', content: text, redact: true, maxLength: text.length + 40 });
  }

  const omittedFiles: string[] = [];
  for (const file of args.files) {
    const header = `${file.path}${file.editable ? '' : ' (read-only reference)'}`;
    const cost = approxTokens(file.content) + 20;
    if (cost > remaining) {
      omittedFiles.push(file.path);
      continue;
    }
    remaining -= cost;
    untrusted.push({
      label: 'file',
      content: `File: ${header}\n${file.content}`,
      redact: false,
      maxLength: file.content.length + header.length + 40,
    });
  }

  const task = [
    `Overall goal: ${args.goal}`,
    `Your task ${args.task.key}: ${args.task.title}`,
    args.task.description ? `Details: ${args.task.description}` : '',
    omittedFiles.length ? `These files were too large to include: ${omittedFiles.join(', ')}. Do not modify them.` : '',
    TASK_OUTPUT_FORMAT,
  ]
    .filter(Boolean)
    .join('\n');

  const call = buildUntrustedCall({ system: roleSystemPrompt(args.role), task, untrusted });
  const tokenEstimate = approxTokens(call.system) + approxTokens(call.messages[0].content);
  return { ...call, tokenEstimate, omittedFiles };
}
