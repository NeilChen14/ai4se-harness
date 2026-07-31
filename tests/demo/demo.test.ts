import { describe, expect, it } from 'vitest';
import { runDemo, DEMO_SCRIPT } from '../../src/demo/demo.js';

describe('mechanism demo', () => {
  it('① guardrail blocks the dangerous action before execution', async () => {
    const report = await runDemo();
    const blocked = report.steps.find(s => s.decision.tier === 'BLOCK');
    expect(blocked).toBeDefined();
    expect(blocked?.action.args.command).toContain('rm -rf');
    expect(blocked?.execution).toBeUndefined();
  });

  it('② feedback loop changes next action after an injected failure', async () => {
    const report = await runDemo();
    const failIdx = report.steps.findIndex(s => s.feedback?.category === 'TEST_FAILURE');
    expect(failIdx).toBeGreaterThanOrEqual(0);
    const next = report.steps[failIdx + 1];
    expect(next).toBeDefined();
    expect(next.action.tool).toBe('write_file'); // 收到失败反馈后改为写修复
  });

  it('③ HITL request transitions PENDING→APPROVED and executes', async () => {
    const report = await runDemo();
    const ask = report.steps.find(s => s.decision.tier === 'ASK');
    expect(ask).toBeDefined();
    expect(ask?.decision.ruleId).toBe('ask-write');
    expect(ask?.execution?.ok).toBe(true); // 批准后已执行
  });

  it('demo script is exactly five steps', () => {
    expect(DEMO_SCRIPT).toHaveLength(5);
  });
});
