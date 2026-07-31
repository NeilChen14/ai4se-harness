import { describe, expect, it } from 'vitest';
import type { Decision, AgentAction } from '../src/types.js';

describe('shared types', () => {
  it('exports Decision and AgentAction', () => {
    const d: Decision = { tier: 'BLOCK', ruleId: 'r1', reason: 'demo' };
    const a: AgentAction = { tool: 'run_command', args: { command: 'echo hi' } };
    expect(d.tier).toBe('BLOCK');
    expect(a.tool).toBe('run_command');
  });
});
