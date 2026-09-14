import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadConstants() {
  vi.resetModules();
  return import('@/lib/agent/constants');
}

describe('agent constants env parsing', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('falls back to the default model when ANTHROPIC_MODEL is unset', async () => {
    delete process.env.ANTHROPIC_MODEL;
    const { getAnthropicModel } = await loadConstants();
    expect(getAnthropicModel()).toBe('claude-sonnet-4-6');
  });

  it('uses ANTHROPIC_MODEL when set', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-custom-model';
    const { getAnthropicModel } = await loadConstants();
    expect(getAnthropicModel()).toBe('claude-custom-model');
  });

  it('trims whitespace around ANTHROPIC_MODEL', async () => {
    process.env.ANTHROPIC_MODEL = '  claude-custom-model  ';
    const { getAnthropicModel } = await loadConstants();
    expect(getAnthropicModel()).toBe('claude-custom-model');
  });

  it('falls back to defaults for invalid MAX_AGENT_TURNS', async () => {
    process.env.MAX_AGENT_TURNS = 'not-a-number';
    const { MAX_AGENT_TURNS } = await loadConstants();
    expect(MAX_AGENT_TURNS).toBe(48);
  });

  it('falls back to defaults for a negative ANTHROPIC_MAX_TOKENS', async () => {
    process.env.ANTHROPIC_MAX_TOKENS = '-5';
    const { ANTHROPIC_MAX_TOKENS } = await loadConstants();
    expect(ANTHROPIC_MAX_TOKENS).toBe(16_384);
  });

  it('respects a valid positive override for MAX_AGENT_TURNS', async () => {
    process.env.MAX_AGENT_TURNS = '10';
    const { MAX_AGENT_TURNS } = await loadConstants();
    expect(MAX_AGENT_TURNS).toBe(10);
  });
});
