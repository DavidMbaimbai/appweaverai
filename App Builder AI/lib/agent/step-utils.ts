import type { AgentFileWriteSnapshot, AgentStep } from '@/lib/agent/types';

const FILE_WRITE_LABEL = /^(Wrote|Writing|Read)\s+/i;

export function isFileRelatedAction(step: AgentStep) {
  if (step.type !== 'action') return false;
  if (!step.path?.includes('.')) return false;
  return FILE_WRITE_LABEL.test(step.label);
}

/** Hide redundant file write/read rows when file cards are shown. */
export function getNonFileSteps(
  steps: AgentStep[],
  fileWrites: AgentFileWriteSnapshot[] = [],
) {
  const filtered =
    fileWrites.length > 0
      ? steps.filter((step) => !isFileRelatedAction(step))
      : steps;

  return dedupeActionSteps(filtered);
}

/** Keep the latest step per path/label to avoid duplicate keys and rows. */
export function dedupeActionSteps(steps: AgentStep[]) {
  const result: AgentStep[] = [];
  const actionIndexByKey = new Map<string, number>();

  for (const step of steps) {
    if (step.type !== 'action') {
      result.push(step);
      continue;
    }

    const key = step.path ?? step.label;
    const existingIndex = actionIndexByKey.get(key);
    if (existingIndex != null) {
      result[existingIndex] = step;
    } else {
      actionIndexByKey.set(key, result.length);
      result.push(step);
    }
  }

  return result;
}

/** Keep one snapshot per file path (latest wins). */
export function dedupeFileWrites(fileWrites: AgentFileWriteSnapshot[]) {
  const byPath = new Map<string, AgentFileWriteSnapshot>();
  for (const file of fileWrites) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

export function normalizeFileContent(content: string) {
  return content.replace(/\r\n/g, '\n');
}
