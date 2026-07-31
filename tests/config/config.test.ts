import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig, defaultConfig, ConfigError } from '../../src/config/config.js';

const write = (name: string, data: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'ai4se-cfg-'));
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data));
  return p;
};

describe('config', () => {
  it('fills defaults when keys are missing', () => {
    const cfg = validateConfig({ workspace: '/tmp/w' });
    expect(cfg.budget.maxSteps).toBe(15);
    expect(cfg.sandbox).toBe('fence-only');
    expect(cfg.llm.provider).toBe('mock');
  });
  it('throws ConfigError naming the bad field', () => {
    expect(() => validateConfig({ budget: { maxSteps: -1 } })).toThrow(ConfigError);
  });
  it('loads a JSON file', () => {
    const p = write('c.json', { llm: { provider: 'openai-compat', model: 'deepseek-chat' }, workspace: '/tmp/w' });
    const cfg = loadConfig(p);
    expect(cfg.llm.model).toBe('deepseek-chat');
    expect(cfg.workspace).toBe('/tmp/w');
  });
  it('throws ConfigError on unreadable file', () => {
    expect(() => loadConfig(join(tmpdir(), 'nope-missing.json'))).toThrow(ConfigError);
  });
  it('produces a working default config', () => {
    expect(defaultConfig().console.port).toBe(8117);
  });
});
