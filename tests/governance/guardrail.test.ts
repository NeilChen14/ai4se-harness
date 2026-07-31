import { describe, expect, it } from 'vitest';
import { GuardrailEngine, PolicyError, PolicyRule } from '../../src/governance/guardrail.js';

const rules: PolicyRule[] = [
  { id: 'no-rm', tier: 'BLOCK', match: { type: 'regex', pattern: 'rm -rf' }, reason: 'destructive' },
  { id: 'ask-write', tier: 'ASK', match: { type: 'exact', pattern: 'write_file' }, reason: 'file modification' },
  { id: 'allow-node', tier: 'ALLOW', match: { type: 'prefix', pattern: 'node --version' }, reason: 'harmless' },
];

describe('GuardrailEngine', () => {
  it('blocks rm -rf without an LLM', () => {
    const g = new GuardrailEngine(rules);
    const d = g.decide({ tool: 'run_command', args: { command: 'rm -rf /tmp/x' } });
    expect(d.tier).toBe('BLOCK');
    expect(d.ruleId).toBe('no-rm');
  });
  it('asks on write_file exact match', () => {
    const g = new GuardrailEngine(rules);
    expect(g.decide({ tool: 'write_file', args: { path: 'a.ts' } }).tier).toBe('ASK');
  });
  it('allows harmless command', () => {
    const g = new GuardrailEngine(rules);
    expect(g.decide({ tool: 'run_command', args: { command: 'node --version' } }).tier).toBe('ALLOW');
  });
  it('BLOCK wins over ASK when both match', () => {
    const g = new GuardrailEngine([
      ...rules,
      { id: 'ask-any', tier: 'ASK', match: { type: 'regex', pattern: 'rm' }, reason: 'x' },
    ]);
    expect(g.decide({ tool: 'run_command', args: { command: 'rm -rf /' } }).tier).toBe('BLOCK');
  });
  it('defaults to ALLOW with reason when no rule matches', () => {
    const g = new GuardrailEngine([]);
    const d = g.decide({ tool: 'read_file', args: { path: 'a.ts' } });
    expect(d.tier).toBe('ALLOW');
    expect(d.reason).toContain('no rule matched');
  });
  it('validate rejects invalid regex and bad tier', () => {
    expect(() => GuardrailEngine.validate([{ id: 'x', tier: 'BLOCK', match: { type: 'regex', pattern: '(' }, reason: 'r' }])).toThrow(PolicyError);
    expect(() => GuardrailEngine.validate([{ id: 'y', tier: 'NOPE' as any, match: { type: 'exact', pattern: 'z' }, reason: 'r' }])).toThrow(PolicyError);
  });
});
