import { randomUUID } from 'node:crypto';
import type { HarnessConfig } from '../config/config.js';
import type { LLMClient, LLMMessage } from '../llm/client.js';
import { decodeAction, FormatError } from '../llm/decode.js';
import type { ToolRegistry, ToolContext } from '../tools/registry.js';
import type { GuardrailEngine } from '../governance/guardrail.js';
import type { ScopeFence } from '../governance/scope.js';
import type { ProcessExecutor } from '../governance/executor.js';
import type { HITLStateMachine, ActionRequest } from '../governance/hitl.js';
import type { FeedbackClassifier } from '../feedback/classifier.js';
import type { MemoryStore } from '../memory/store.js';
import type { AgentAction, Decision, Feedback, SessionStatus, StepRecord, ToolResult } from '../types.js';
import { buildSystemPrompt } from './prompt.js';

export type { SessionStatus } from '../types.js';

export type SessionEvent =
  | { type: 'status'; status: SessionStatus }
  | { type: 'step'; step: StepRecord }
  | { type: 'ask'; requestId: string; action: AgentAction };

export interface SessionReport { sessionId: string; status: SessionStatus; steps: StepRecord[]; reason: string; }

export interface SessionDeps {
  task: string;
  config: HarnessConfig;
  llm: LLMClient;
  tools: ToolRegistry;
  guardrail: GuardrailEngine;
  scope: ScopeFence;
  executor: ProcessExecutor;
  hitl: HITLStateMachine;
  classifier: FeedbackClassifier;
  memory: MemoryStore;
  resolveApproval?: (req: ActionRequest) => Promise<ActionRequest>;
  onEvent?: (ev: SessionEvent) => void;
}

const VALIDATORS = ['run_tests', 'run_typecheck', 'run_lint'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class HarnessSession {
  private aborted = false;
  constructor(private readonly deps: SessionDeps) {}

  abort() { this.aborted = true; }

  private emit(ev: SessionEvent) { this.deps.onEvent?.(ev); }

  async run(): Promise<SessionReport> {
    const { task, config, llm, tools, guardrail, scope, executor, hitl, classifier, memory } = this.deps;
    const sessionId = randomUUID();
    const steps: StepRecord[] = [];
    const messages: LLMMessage[] = [
      { role: 'system', content: buildSystemPrompt(config) },
      { role: 'user', content: `Task: ${task}` },
    ];
    const mem = await memory.summary(10);
    if (mem) messages.push({ role: 'user', content: `Project context:\n${mem}` });

    const ctx: ToolContext = { scope, executor, workdir: config.workspace };
    let status: SessionStatus = 'running';
    let reason = '';
    let failures = 0;
    let seenMutation = false;
    let stepIndex = 0;

    for (; stepIndex < config.budget.maxSteps; stepIndex++) {
      if (this.aborted) { status = 'aborted'; reason = 'user aborted'; break; }

      const record = (action: AgentAction, decision: Decision, execution?: ToolResult, feedback?: Feedback): StepRecord => {
        const step: StepRecord = {
          index: stepIndex, action, decision, execution, feedback,
          llmCallId: `step-${stepIndex}`, ts: new Date().toISOString(),
        };
        steps.push(step);
        this.emit({ type: 'step', step });
        return step;
      };

      let llmResult;
      try { llmResult = await llm.complete(messages); }
      catch (e) {
        failures++;
        const fb: Feedback = { category: 'OTHER', summary: `llm error: ${(e as Error).message}` };
        record({ tool: 'error', args: {} }, { tier: 'ALLOW', reason: 'llm call failed' }, undefined, fb);
        messages.push({ role: 'user', content: `Feedback: ${fb.summary}` });
        if (failures >= config.budget.maxFailures) { status = 'stalled'; reason = 'llm failures exceeded'; break; }
        continue;
      }

      let action: AgentAction;
      try { action = decodeAction(llmResult.content); }
      catch (e) {
        failures++;
        const fb: Feedback = { category: 'FORMAT_ERROR', summary: `action format error: ${(e as FormatError).message}` };
        record({ tool: 'error', args: {} }, { tier: 'ALLOW', reason: 'format' }, undefined, fb);
        messages.push({ role: 'user', content: `Feedback: ${fb.summary}` });
        if (failures >= config.budget.maxFailures) { status = 'stalled'; reason = 'format failures exceeded'; break; }
        continue;
      }

      const decision = guardrail.decide(action);

      if (decision.tier === 'BLOCK') {
        failures++;
        const fb: Feedback = { category: 'OTHER', summary: `blocked by policy: ${decision.reason}` };
        record(action, decision, undefined, fb);
        messages.push({ role: 'assistant', content: llmResult.content });
        messages.push({ role: 'user', content: `Feedback: ${fb.summary}` });
        if (failures >= config.budget.maxFailures) { status = 'stalled'; reason = 'too many blocked actions'; break; }
        continue;
      }

      let execution: ToolResult | undefined;
      if (decision.tier === 'ASK') {
        const req = await hitl.request(action, sessionId);
        this.emit({ type: 'ask', requestId: req.id, action });
        const decided = await (this.deps.resolveApproval ?? defaultResolve(hitl))(req);
        if (decided.status !== 'APPROVED') {
          failures++;
          const fb: Feedback = { category: 'OTHER', summary: `action ${decided.status.toLowerCase()} by user` };
          record(action, decision, undefined, fb);
          messages.push({ role: 'assistant', content: llmResult.content });
          messages.push({ role: 'user', content: `Feedback: ${fb.summary}` });
          if (failures >= config.budget.maxFailures) { status = 'stalled'; reason = 'approvals denied'; break; }
          continue;
        }
      }

      execution = await tools.dispatch(action, ctx);
      const feedback = classifier.classify(action.tool, execution);
      if (action.tool === 'write_file' && execution.ok) seenMutation = true;
      record(action, decision, execution, feedback);
      messages.push({ role: 'assistant', content: llmResult.content });
      messages.push({
        role: 'user',
        content: `Tool result: ${execution.ok ? execution.output : `error: ${execution.error}`}\nFeedback: ${feedback.summary}`,
      });

      if (action.tool === 'done') { status = 'done'; reason = String(action.args.summary ?? 'done'); break; }
      if (VALIDATORS.includes(action.tool) && feedback.category === 'PASS' && seenMutation) {
        status = 'done'; reason = `${action.tool} passed after mutation`; break;
      }
      if (feedback.category === 'PASS') failures = 0;
      else failures++;
      if (failures >= config.budget.maxFailures) { status = 'stalled'; reason = 'too many consecutive failures'; break; }
    }

    if (status === 'running') { status = 'stalled'; reason = 'max steps reached'; }
    await memory.add('task-decision', `Task "${task}" ended with ${status}: ${reason}`);
    this.emit({ type: 'status', status });
    return { sessionId, status, steps, reason };
  }
}

function defaultResolve(hitl: HITLStateMachine) {
  return async (req: ActionRequest): Promise<ActionRequest> => {
    const deadline = Date.now() + req.ttlMs;
    while (Date.now() < deadline) {
      const cur = await hitl.get(req.id);
      if (cur && cur.status !== 'PENDING') return cur;
      await sleep(50);
    }
    return hitl.timeout(req.id);
  };
}
