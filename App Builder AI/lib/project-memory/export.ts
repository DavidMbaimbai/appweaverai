import { TYPE_LABELS, type MemoryRecord } from './types';

/** Markdown export of a project's memory. Statuses other than ACTIVE are kept so history survives a round trip. */
export function memoryToMarkdown(projectName: string, memories: MemoryRecord[], now = new Date()): string {
  const lines: string[] = [`# Project memory: ${projectName}`, '', `Exported ${now.toISOString()}`, ''];
  const order = ['ACTIVE', 'SUPERSEDED', 'REJECTED'] as const;
  for (const status of order) {
    const group = memories.filter((m) => m.status === status);
    if (group.length === 0) continue;
    lines.push(`## ${status.charAt(0)}${status.slice(1).toLowerCase()} (${group.length})`, '');
    for (const m of group) {
      const flags = [TYPE_LABELS[m.type], m.pinned ? 'pinned' : null, m.featureState ? m.featureState.toLowerCase() : null, `source: ${m.source.toLowerCase()}`, `confidence ${Math.round(m.confidence * 100)}%`]
        .filter(Boolean)
        .join(' · ');
      lines.push(`### ${m.title.replace(/\s+/g, ' ')}`, '', `_${flags}_`, '', m.body.trim(), '');
      if (m.files.length > 0) lines.push(`Files: ${m.files.map((f) => `\`${f}\``).join(', ')}`, '');
      const evidence = m.evidence;
      if (evidence?.checkpointId || evidence?.messageId) {
        lines.push(`Evidence: ${[evidence.checkpointId ? `checkpoint ${evidence.checkpointId}` : null, evidence.messageId ? `message ${evidence.messageId}` : null].filter(Boolean).join(', ')}`, '');
      }
    }
  }
  if (memories.length === 0) lines.push('_No memory entries yet._', '');
  return lines.join('\n');
}
