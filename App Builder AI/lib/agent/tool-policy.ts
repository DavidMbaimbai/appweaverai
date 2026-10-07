import type { AgentToolRiskLevel } from '@/lib/generated/prisma/client';

/**
 * Static risk classification for agent tools. SAFE/REVIEW tools auto-execute
 * (and are logged for audit); DESTRUCTIVE tools must be approved by the user
 * before lib/agent/run-agent.ts will execute them. Default to DESTRUCTIVE for
 * any tool not explicitly listed here, so newly added tools fail safe.
 */
const TOOL_RISK_LEVELS: Record<string, AgentToolRiskLevel> = {
  list_files: 'SAFE',
  read_file: 'SAFE',
  ask_plan_question: 'SAFE',
  complete_plan: 'SAFE',
  complete_build: 'SAFE',
  write_file: 'REVIEW',
  edit_file: 'REVIEW',
  delete_file: 'DESTRUCTIVE',
};

export function getToolRiskLevel(toolName: string): AgentToolRiskLevel {
  return TOOL_RISK_LEVELS[toolName] ?? 'DESTRUCTIVE';
}

export function requiresApproval(toolName: string): boolean {
  return getToolRiskLevel(toolName) === 'DESTRUCTIVE';
}
