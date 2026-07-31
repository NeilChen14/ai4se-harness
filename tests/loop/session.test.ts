import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessSession } from '../../src/loop/session.js';
import { MockLLM } from '../../src/llm/mock.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { readFileTool, writeFileTool } from '../../src/tools/file.js';
import { runCommandTool, runTestsTool, doneTool } from '../../src/tools/run.js';
import { GuardrailEngine, PolicyRule } from '../../src/governance/guardrail.js';
import { ScopeFence } from '../../src/governance/scope.js';
import { ProcessExecutor } from '../../src/governance/executor.js';
import { HITLStateMachine, ActionRequest } from '../../src/governance/hitl.js';
import { FeedbackClassifier } from '../../src/feedback/classifier.js';
import { MemoryStore } from '../../src/memory/store.js';
import { InMemoryStore } from '../helpers/inmem.js';
import type { HarnessConfig } from '../../src/config/config.js';

const reg = () => {
  const r = new ToolRegistry();
  [readFileTool, writeFileTool, runCommandTool, runTestsTool, doneTool].forEach(t => r.register(t));
  return r;
};

const pkg = (dir: string) => writeFileSync(join(dir, 'package.json'), '{"type":"module"}', 'utf8'); // node --test 需要 ESM 上下文
const policy: PolicyRule[] = [
  { id: 'no-rm', tier: 'BLOCK', match: { type: 'regex', pattern: 'rm -rf' }, reason: 'destructive' },
  { id: 'ask-run', tier: 'ASK', match: { type: 'prefix', pattern: 'node --version' }, reason: 'ask for demo' },
];

function config(dir: string): HarnessConfig {
  return {
    llm: { provider: 'mock' },
    workspace: dir,
    policy,
    tools: { enabled: ['read_file', 'write_file', 'run_command', 'run_tests', 'done'] },
    sandbox: 'fence-only',
    budget: { maxSteps: 10, maxFailures: 3 },
    memory: { filePath: join(dir, 'mem.jsonl') },
    console: { port: 8117, host: '127.0.0.1' },
  };
}

const approver = (status: 'APPROVED' | 'DENIED') => async (req: ActionRequest): Promise<ActionRequest> => ({
  ...req, status, decidedAt: Date.now(), decidedBy: 'test',
});

const FAILING_TEST = `import { test } from 'node:test';
import assert from 'node:assert';
import { sum } from './sum.js';
test('sum(1,2)=3', () => assert.strictEqual(sum(1, 2), 3));`;

describe('HarnessSession', () => {
  it('completes a task via feedback loop with mock LLM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    pkg(dir);
    writeFileSync(join(dir, 'sum.test.js'), FAILING_TEST);
    const llm = new MockLLM([
      '{"tool":"run_tests","args":{}}',
      '{"tool":"write_file","args":{"path":"sum.js","content":"export function sum(a,b){return a+b;}"}}',
      '{"tool":"run_tests","args":{}}',
    ]);
    const session = new HarnessSession({
      task: 'fix sum',
      config: config(dir),
      llm,
      tools: reg(),
      guardrail: new GuardrailEngine(policy),
      scope: new ScopeFence([dir]),
      executor: new ProcessExecutor(),
      hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(),
      memory: new MemoryStore(join(dir, 'mem.jsonl')),
    });
    const report = await session.run();
    expect(report.status).toBe('done');
    // 校验器 PASS 且发生过 write_file → 自动 done，`done` 工具无需消费
    expect(report.steps.map(s => s.action.tool)).toEqual(['run_tests', 'write_file', 'run_tests']);
    expect(report.steps.some(s => s.feedback?.category === 'TEST_FAILURE')).toBe(true);
  });

  it('done tool terminates the session explicitly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    pkg(dir);
    const llm = new MockLLM([
      '{"tool":"run_tests","args":{}}',
      '{"tool":"done","args":{"summary":"ok"}}',
    ]);
    const session = new HarnessSession({
      task: 't', config: config(dir), llm, tools: reg(),
      guardrail: new GuardrailEngine(policy), scope: new ScopeFence([dir]),
      executor: new ProcessExecutor(), hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(), memory: new MemoryStore(join(dir, 'mem.jsonl')),
    });
    const report = await session.run();
    expect(report.status).toBe('done');
    expect(report.steps.map(s => s.action.tool)).toEqual(['run_tests', 'done']);
  });

  it('guardrail blocks dangerous action; agent continues and finishes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    const llm = new MockLLM([
      '{"tool":"run_command","args":{"command":"rm -rf /tmp/x"}}',
      '{"tool":"run_tests","args":{}}',
      '{"tool":"write_file","args":{"path":"a.js","content":"// fix"}}',
      '{"tool":"done","args":{"summary":"done"}}',
    ]);
    const session = new HarnessSession({
      task: 't', config: config(dir), llm, tools: reg(),
      guardrail: new GuardrailEngine(policy),
      scope: new ScopeFence([dir]), executor: new ProcessExecutor(),
      hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(),
      memory: new MemoryStore(join(dir, 'mem.jsonl')),
    });
    const report = await session.run();
    const blocked = report.steps.find(s => s.decision.tier === 'BLOCK');
    expect(blocked).toBeDefined();
    expect(blocked?.execution).toBeUndefined(); // 未执行
    expect(report.status).toBe('done');
  });

  it('ASK action runs only after approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    const llm = new MockLLM([
      '{"tool":"run_command","args":{"command":"node --version"}}',
      '{"tool":"done","args":{"summary":"ok"}}',
    ]);
    const session = new HarnessSession({
      task: 't', config: config(dir), llm, tools: reg(),
      guardrail: new GuardrailEngine(policy),
      scope: new ScopeFence([dir]), executor: new ProcessExecutor(),
      hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(),
      memory: new MemoryStore(join(dir, 'mem.jsonl')),
      resolveApproval: approver('APPROVED'),
    });
    const report = await session.run();
    const askStep = report.steps.find(s => s.decision.tier === 'ASK');
    expect(askStep).toBeDefined();
    expect(askStep?.execution?.ok).toBe(true);
  });

  it('denied ASK action is not executed and counted as failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    const llm = new MockLLM([
      '{"tool":"run_command","args":{"command":"node --version"}}',
      '{"tool":"done","args":{"summary":"ok"}}',
    ]);
    const session = new HarnessSession({
      task: 't', config: config(dir), llm, tools: reg(),
      guardrail: new GuardrailEngine(policy),
      scope: new ScopeFence([dir]), executor: new ProcessExecutor(),
      hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(),
      memory: new MemoryStore(join(dir, 'mem.jsonl')),
      resolveApproval: approver('DENIED'),
    });
    const report = await session.run();
    const askStep = report.steps.find(s => s.decision.tier === 'ASK');
    expect(askStep?.execution).toBeUndefined();
    expect(String(askStep?.feedback?.summary)).toMatch(/denied/i);
  });

  it('hits maxFailures and stalls on repeated bad output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    const llm = new MockLLM([
      'not json at all',
      'also not json',
      'still not json',
    ]);
    const session = new HarnessSession({
      task: 't', config: config(dir), llm, tools: reg(),
      guardrail: new GuardrailEngine(policy),
      scope: new ScopeFence([dir]), executor: new ProcessExecutor(),
      hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(),
      memory: new MemoryStore(join(dir, 'mem.jsonl')),
    });
    const report = await session.run();
    expect(report.status).toBe('stalled');
    expect(report.steps.every(s => s.feedback?.category === 'FORMAT_ERROR')).toBe(true);
  });

  it('injects TEST_FAILURE feedback into the next LLM call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-loop-'));
    pkg(dir);
    writeFileSync(join(dir, 'sum.test.js'), FAILING_TEST);
    let sawFeedback = false;
    const llm = new MockLLM([
      '{"tool":"run_tests","args":{}}',
      (messages) => {
        const joined = messages.map(m => m.content).join('\n');
        sawFeedback = joined.includes('TEST_FAILURE');
        return '{"tool":"done","args":{"summary":"ok"}}';
      },
    ]);
    const session = new HarnessSession({
      task: 't', config: config(dir), llm, tools: reg(),
      guardrail: new GuardrailEngine(policy),
      scope: new ScopeFence([dir]), executor: new ProcessExecutor(),
      hitl: new HITLStateMachine(new InMemoryStore()),
      classifier: new FeedbackClassifier(),
      memory: new MemoryStore(join(dir, 'mem.jsonl')),
    });
    await session.run();
    expect(sawFeedback).toBe(true);
  });
});
