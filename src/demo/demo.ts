import { readFileSync, cpSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PolicyRule } from '../governance/guardrail.js';
import { GuardrailEngine } from '../governance/guardrail.js';
import { ScopeFence } from '../governance/scope.js';
import { ProcessExecutor } from '../governance/executor.js';
import { HITLStateMachine, ActionRequest, RequestStore } from '../governance/hitl.js';
import { FeedbackClassifier } from '../feedback/classifier.js';
import { MemoryStore } from '../memory/store.js';
import { ToolRegistry } from '../tools/registry.js';
import { readFileTool, writeFileTool } from '../tools/file.js';
import { runCommandTool, runTestsTool, doneTool } from '../tools/run.js';
import { MockLLM } from '../llm/mock.js';
import { HarnessSession, SessionDeps, SessionReport, SessionEvent } from '../loop/session.js';
import type { HarnessConfig } from '../config/config.js';
import type { SessionRunner, SessionInfo } from '../console/server.js';

export function demoProjectRoot(): string {
  return fileURLToPath(new URL('./project/', import.meta.url));
}
export function demoPolicy(): PolicyRule[] {
  return JSON.parse(readFileSync(new URL('./project/policy.json', import.meta.url), 'utf8'));
}
export function demoTools(): ToolRegistry {
  const r = new ToolRegistry();
  [readFileTool, writeFileTool, runCommandTool, runTestsTool, doneTool].forEach(t => r.register(t));
  return r;
}
function tempDemoProject(): string {
  // 每次把 demo 工程复制到临时目录，保证运行可重复、不污染提交的 src/demo/project
  const dir = mkdtempSync(join(tmpdir(), 'ai4se-demo-'));
  cpSync(demoProjectRoot(), dir, { recursive: true });
  return dir;
}
export const DEMO_SCRIPT: string[] = [
  '{"tool":"run_command","args":{"command":"rm -rf /tmp/ai4se-demo"}}',
  '{"tool":"run_tests","args":{}}',
  '{"tool":"write_file","args":{"path":"sum.js","content":"export function sum(a,b){return a+b;}"}}',
  '{"tool":"run_tests","args":{}}',
  '{"tool":"done","args":{"summary":"sum fixed"}}',
];

class MapStore implements RequestStore {
  private m = new Map<string, ActionRequest>();
  async save(r: ActionRequest) { this.m.set(r.id, r); }
  async update(r: ActionRequest) { this.m.set(r.id, r); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async all() { return [...this.m.values()]; }
}

export function buildDemoSession(opts: { approvals?: 'auto' | 'deny' } = {}): { deps: SessionDeps; events: SessionEvent[]; hitl: HITLStateMachine } {
  const root = tempDemoProject();
  const config: HarnessConfig = {
    llm: { provider: 'mock' },
    workspace: root,
    policy: demoPolicy(),
    tools: { enabled: ['read_file', 'write_file', 'run_command', 'run_tests', 'done'] },
    sandbox: 'fence-only',
    budget: { maxSteps: 8, maxFailures: 4 },
    memory: { filePath: join(root, '.harness-memory.jsonl') },
    console: { port: 8117, host: '127.0.0.1' },
  };
  const hitl = new HITLStateMachine(new MapStore(), 120_000);
  const events: SessionEvent[] = [];
  const auto = opts.approvals === 'deny'
    ? async (req: ActionRequest) => hitl.deny(req.id, 'demo')
    : async (req: ActionRequest) => hitl.approve(req.id, 'demo');
  const deps: SessionDeps = {
    task: 'Make sum.test.js pass',
    config,
    llm: new MockLLM(DEMO_SCRIPT),
    tools: demoTools(),
    guardrail: new GuardrailEngine(demoPolicy()),
    scope: new ScopeFence([root]),
    executor: new ProcessExecutor(),
    hitl,
    classifier: new FeedbackClassifier(),
    memory: new MemoryStore(config.memory.filePath),
    resolveApproval: auto,
    onEvent: ev => events.push(ev),
  };
  return { deps, events, hitl };
}

export async function runDemo(opts?: { approvals?: 'auto' | 'deny' }): Promise<SessionReport> {
  const { deps, events } = buildDemoSession(opts);
  const report = await new HarnessSession(deps).run();
  const blocked = report.steps.find(s => s.decision.tier === 'BLOCK');
  const failIdx = report.steps.findIndex(s => s.feedback?.category === 'TEST_FAILURE');
  const ask = report.steps.find(s => s.decision.tier === 'ASK');
  console.log('[DEMO ①] guardrail:', blocked ? `BLOCKED ${blocked.action.args.command}` : 'not shown');
  console.log('[DEMO ②] feedback :', failIdx >= 0 ? `TEST_FAILURE at step ${failIdx} -> next ${report.steps[failIdx + 1]?.action.tool}` : 'not shown');
  console.log('[DEMO ③] hitl     :', ask ? `PENDING->APPROVED, executed=${ask.execution?.ok === true}` : 'not shown');
  console.log(`[DEMO] report status=${report.status} steps=${report.steps.length} reason=${report.reason}`);
  return report;
}

export class DemoSessionRunner implements SessionRunner {
  private sessions: SessionInfo[] = [];
  private cbs: Array<(ev: SessionEvent) => void> = [];
  private currentHitl: HITLStateMachine | null = null;

  constructor(private readonly base = fileURLToPath(new URL('../../sessions/', import.meta.url))) {}

  onEvent(cb: (ev: SessionEvent) => void) {
    this.cbs.push(cb);
    return () => { this.cbs = this.cbs.filter(c => c !== cb); };
  }
  async startDemo(): Promise<string> {
    const { deps, events, hitl } = buildDemoSession({ approvals: 'auto' });
    this.currentHitl = hitl;
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const broadcast = (ev: SessionEvent) => this.cbs.forEach(c => c(ev));
    deps.onEvent = ev => { events.push(ev); broadcast(ev); };
    const report = await new HarnessSession(deps).run();
    this.sessions.unshift({ sessionId, status: report.status, task: deps.task, startedAt });
    this.sessions = this.sessions.slice(0, 50);
    return sessionId;
  }
  async approve(id: string) {
    if (!this.currentHitl) throw new Error('no active session');
    await this.currentHitl.approve(id, 'console');
  }
  async deny(id: string) {
    if (!this.currentHitl) throw new Error('no active session');
    await this.currentHitl.deny(id, 'console');
  }
  async list() { return this.sessions; }
}

const isDirectRun = (() => {
  try {
    const expected = fileURLToPath(import.meta.url);
    const actual = typeof process.argv[1] === 'string' ? process.argv[1] : '';
    const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase().replaceAll('\\', '/') : p);
    return norm(expected) === norm(actual);
  } catch { return false; }
})();

if (isDirectRun) {
  void runDemo().then(r => { process.exitCode = r.status === 'done' ? 0 : 1; });
}
