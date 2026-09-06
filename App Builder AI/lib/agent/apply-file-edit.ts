export type ApplyFileEditResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; error: string };

function countOccurrences(content: string, needle: string) {
  if (!needle) return 0;

  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Apply a targeted search-and-replace edit without rewriting the whole file. */
export function applyFileEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ApplyFileEditResult {
  const oldText = oldString.replace(/\r\n/g, '\n');
  const newText = newString.replace(/\r\n/g, '\n');
  const normalizedContent = content.replace(/\r\n/g, '\n');

  if (!oldText) {
    return { ok: false, error: 'old_string must not be empty.' };
  }

  const matches = countOccurrences(normalizedContent, oldText);

  if (matches === 0) {
    return {
      ok: false,
      error:
        'old_string was not found in the file. read_file again and copy the exact text to replace, including whitespace and indentation.',
    };
  }

  if (!replaceAll && matches > 1) {
    return {
      ok: false,
      error: `old_string matched ${matches} times. Include more surrounding context so it is unique, or set replace_all to true if every match should change.`,
    };
  }

  const nextContent = replaceAll
    ? normalizedContent.split(oldText).join(newText)
    : normalizedContent.replace(oldText, newText);

  return {
    ok: true,
    content: nextContent,
    replacements: replaceAll ? matches : 1,
  };
}
