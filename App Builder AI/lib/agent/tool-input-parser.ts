/** Best-effort extraction of write_file fields from partial tool JSON. */
export function extractWriteFilePartial(partialJson: string): {
  path?: string;
  content?: string;
} {
  const pathMatch = partialJson.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const path = pathMatch ? unescapeJsonString(pathMatch[1]) : undefined;

  const contentMarker = partialJson.match(/"content"\s*:\s*"/);
  if (!contentMarker || contentMarker.index == null) {
    return { path };
  }

  const startIndex = contentMarker.index + contentMarker[0].length;
  let raw = '';
  let index = startIndex;

  while (index < partialJson.length) {
    const char = partialJson[index];
    if (char === '\\' && index + 1 < partialJson.length) {
      raw += partialJson.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '"') {
      break;
    }
    raw += char;
    index += 1;
  }

  return { path, content: unescapeJsonString(raw) };
}

/** Best-effort extraction of complete_build summary from partial tool JSON. */
export function extractCompleteBuildPartial(partialJson: string): {
  summary?: string;
} {
  const summaryMarker = partialJson.match(/"summary"\s*:\s*"/);
  if (!summaryMarker || summaryMarker.index == null) {
    return {};
  }

  const startIndex = summaryMarker.index + summaryMarker[0].length;
  let raw = '';
  let index = startIndex;

  while (index < partialJson.length) {
    const char = partialJson[index];
    if (char === '\\' && index + 1 < partialJson.length) {
      raw += partialJson.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '"') {
      break;
    }
    raw += char;
    index += 1;
  }

  return { summary: unescapeJsonString(raw) };
}

function unescapeJsonString(value: string) {
  try {
    return JSON.parse(
      `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    ) as string;
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

export function languageFromPath(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'html',
    htm: 'html',
    css: 'css',
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    svg: 'svg',
    md: 'markdown',
  };
  return map[ext] ?? 'text';
}
