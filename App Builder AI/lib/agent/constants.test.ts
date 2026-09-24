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

  it('falls back to the default Bedrock model when BEDROCK_MODEL_ID is unset', async () => {
    delete process.env.BEDROCK_MODEL_ID;
    const { getAnthropicModel } = await loadConstants();
    expect(getAnthropicModel()).toBe('eu.anthropic.claude-sonnet-4-5-20250929-v1:0');
  });

  it('uses BEDROCK_MODEL_ID when set', async () => {
    process.env.BEDROCK_MODEL_ID = 'custom.bedrock-model:0';
    const { getAnthropicModel } = await loadConstants();
    expect(getAnthropicModel()).toBe('custom.bedrock-model:0');
  });

  it('trims whitespace around BEDROCK_MODEL_ID', async () => {
    process.env.BEDROCK_MODEL_ID = '  custom.bedrock-model:0  ';
    const { getAnthropicModel } = await loadConstants();
    expect(getAnthropicModel()).toBe('custom.bedrock-model:0');
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
