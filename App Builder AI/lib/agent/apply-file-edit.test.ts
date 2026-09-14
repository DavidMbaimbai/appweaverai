import { describe, expect, it } from 'vitest';

import { applyFileEdit } from '@/lib/agent/apply-file-edit';

describe('applyFileEdit', () => {
  it('replaces a single unique match', () => {
    const result = applyFileEdit('const x = 1;\nconst y = 2;', 'const x = 1;', 'const x = 42;');
    expect(result).toEqual({
      ok: true,
      content: 'const x = 42;\nconst y = 2;',
      replacements: 1,
    });
  });

  it('fails when old_string is empty', () => {
    const result = applyFileEdit('content', '', 'new');
    expect(result).toEqual({ ok: false, error: 'old_string must not be empty.' });
  });

  it('fails when old_string is not found', () => {
    const result = applyFileEdit('const x = 1;', 'const z = 9;', 'const z = 10;');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/was not found/);
    }
  });

  it('fails on ambiguous (multiple) matches without replace_all', () => {
    const content = 'foo\nfoo\nfoo';
    const result = applyFileEdit(content, 'foo', 'bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/matched 3 times/);
    }
  });

  it('replaces every occurrence when replace_all is true', () => {
    const content = 'foo\nfoo\nfoo';
    const result = applyFileEdit(content, 'foo', 'bar', true);
    expect(result).toEqual({ ok: true, content: 'bar\nbar\nbar', replacements: 3 });
  });

  it('normalizes CRLF line endings before matching', () => {
    const content = 'line1\r\nline2\r\nline3';
    const result = applyFileEdit(content, 'line2', 'replaced');
    expect(result).toEqual({
      ok: true,
      content: 'line1\nreplaced\nline3',
      replacements: 1,
    });
  });

  it('supports deleting text via an empty new_string', () => {
    const result = applyFileEdit('keep-remove-keep', 'remove-', '');
    expect(result).toEqual({ ok: true, content: 'keep-keep', replacements: 1 });
  });
});
