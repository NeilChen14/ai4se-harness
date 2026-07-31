# Coding Agent Harness（方向 A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 TypeScript 自研一个 Coding Agent Harness（主循环 + mock 可注入 LLM 抽象 + 工具分发 + 治理护栏 + 反馈闭环 + 记忆 + 停机判断），以**治理/护栏/沙箱**为主贡献，全部核心机制可用 mock LLM 做确定性单测，并交付 npm + Docker 分发与 GitHub Actions CI。

**Architecture:** 单体模块化内核（`src/loop|llm|tools|governance|feedback|memory|config|secret|console|demo`）。HarnessSession 主循环：组装上下文 → 调 LLM → 解析动作 → GuardrailEngine 决策 → (ASK 时 HITL) → ToolRegistry 分发 → FeedbackClassifier 回灌 → 停机判断。治理四件套（护栏规则引擎 / 范围围栏 / 进程执行器 / HITL 态机）全部为确定性代码，移除 LLM 仍可单测。

**Tech Stack:** TypeScript(strict) / Node ≥ 20(ESM) / Vitest / `commander` / `ws` / Node 内置 `crypto·child_process·fs·path`。测试命令：`npm test`（=`vitest run`）。

## Global Constraints

- Node ≥ 20，ESM（`"type": "module"`），TypeScript `strict: true`；**相对 import 一律带 `.js` 后缀**（`NodeNext` 硬性要求，`tsc build` 会因缺后缀报 TS2835；vitest 容忍缺省但 build 会挂，统一写 `.js`）。
- **禁止**使用任何现成 agent 编排框架（LangChain `AgentExecutor`、AutoGen、CrewAI、LlamaIndex agent 等）；主循环 / 工具分发 / 治理 / 反馈 / 停机必须自编码。仅允许 LLM 单次补全 API、`ws`、`commander`、Node 内置模块作底层零件。
- **TDD 硬性纪律**：每步先写失败测试并运行确认 RED → 最小实现 → 确认 GREEN → 重构。禁止先实现后补测试。
- **凭据红线**：任何 key 绝不硬编码、绝不提交 git、绝不写日志/终端 history；`ProcessExecutor` 必须过滤含 `SECRET|KEY|TOKEN|PASSWORD|AI4SE_` 的环境变量（正则 `/AI4SE_|SECRET|KEY|TOKEN|PASSWORD/i`）。
- 文件路径一律绝对化 + 规范化（`realpath`）后比较；Windows/Linux 行为差异由路径抽象层统一处理。
- 测试命令：`npm test`（单测）、`npm run demo`（机制演示）、`npm run build`（tsc 编译）。CI（GitHub Actions）每次 push 跑 `npm test`。
- 每完成一个 task：按本文件 Step 提交 commit，并**更新 PLAN.md**（勾选 + 记 commit hash），同时记录到 `AGENT_LOG.md`。
- 每个 task 在独立 git worktree 的 `wt/<module>` 分支上完成，对应一个 PR；PR 描述注明 subagent 与人工修改。
- 本 PLAN 与 `SPEC.md` 是唯一事实来源（冷启动验证 §4.5 用）：实现者不得凭猜测推断未写明的行为；遇到不确定处暂停询问。

## 前置流程（实现开始前，人工完成）

- [x] **SPEC_PROCESS.md**：按 §4.4 记录 brainstorming 关键节点 + 至少 3 轮迭代节选 + AI 建议采纳/否决记录 + 技能反思。
- [x] **§4.5 冷启动验证**：用一个**不同类型的新 agent**、仅凭 `SPEC.md` + `PLAN.md` 实现 1–2 个 task，不提供对话历史；要求"不确定即暂停询问"。把停顿点、spec 缺陷、解读分歧、以及据此对 SPEC/PLAN 的修订（关键 diff）写入 `SPEC_PROCESS.md`。
- [x] 冷启动发现的问题回写本 PLAN（勾选/修正后才开始 T1）——**冷启动结果：0 停顿点、0 缺陷、7/7 测试通过，无需修订 SPEC/PLAN，签字通过**。

## 依赖与并行

```
T1 Foundation
 └─► Phase 1（10 个 task 可并行，各自独立 worktree）
     T2 config │ T3 secret │ T4 llm │ T5 tools │ T6a guardrail
     │ T6b scope │ T6c executor │ T6d hitl │ T7 feedback │ T8 memory
      └─► T9 Loop（依赖全部 Phase 1）
           └─► Phase 3（并行）T10 console │ T11 demo
                └─► T12 CLI（依赖 T9+T10+T11）
                     └─► T13 Packaging/README/CI/final（依赖全部）
```

---

## Task 1: Project Foundation（脚手架 + 共享类型 + CI）

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `.github/workflows/ci.yml`, `src/types.ts`, `src/index.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Consumes: 无（本项目第一个 task）。
- Produces: 共享类型（所有后续 task 引用）——`src/types.ts` 导出 `Tier`、`SessionStatus`、`FeedbackCategory`、`AgentAction`、`Decision`、`ToolResult`、`Feedback`、`StepRecord`。

- [ ] **Step 1: 写失败测试 `tests/smoke.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`src/types.ts` 不存在 / 模块找不到）。

- [ ] **Step 3: 最小实现**

`src/types.ts`：

```ts
export type Tier = 'ALLOW' | 'ASK' | 'BLOCK';
export type SessionStatus = 'running' | 'done' | 'stalled' | 'aborted';
export type FeedbackCategory =
  | 'PASS' | 'COMPILE_ERROR' | 'TEST_FAILURE' | 'LINT_ERROR'
  | 'TIMEOUT' | 'FORMAT_ERROR' | 'OTHER';

export interface AgentAction { tool: string; args: Record<string, unknown>; }
export interface Decision { tier: Tier; ruleId?: string; reason: string; }
export interface ToolResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  error?: string;
}
export interface Feedback { category: FeedbackCategory; summary: string; }
export interface StepRecord {
  index: number;
  action: AgentAction;
  decision: Decision;
  execution?: ToolResult;
  feedback?: Feedback;
  llmCallId: string;
  ts: string;
}
```

`package.json`：

```json
{
  "name": "ai4se-harness",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ai4se-harness": "dist/cli.js" },
  "files": ["dist", "README.md"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.build.json && node -e \"const fs=require('node:fs');fs.cpSync('src/demo/project','dist/demo/project',{recursive:true});fs.cpSync('src/console/static','dist/console/static',{recursive:true})\"",
    "demo": "tsx src/demo/demo.ts",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": { "commander": "^12.1.0", "ws": "^8.18.0" },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`tsconfig.build.json`：

```json
{ "extends": "./tsconfig.json", "include": ["src"], "exclude": ["src/demo/project"] }
```

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

`.gitignore`：

```
node_modules/
dist/
coverage/
sessions/
.env
**/secrets.json
```

`.github/workflows/ci.yml`：

```yaml
name: CI
on: [push, pull_request]
jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
```

`src/index.ts`：`export * from './types.js';`

- [ ] **Step 4: 运行确认通过**

Run: `npm install && npm test`
Expected: PASS（1 条 smoke 测试）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(T1): project scaffold, shared types, vitest, CI"
```

- [x] **Step 6: 更新 PLAN.md**（勾选 Task 1，记录 `git rev-parse --short HEAD`）与 `AGENT_LOG.md`，提交。T1 commit（cherry-pick 自冷启动）`bcf67a6`，`npm test` 1/1 通过。

---

## Task 2: Config 模块

**Files:**
- Create: `src/config/config.ts`, `tests/config/config.test.ts`

**Interfaces:**
- Consumes: 无（纯数据 + Node 内置）。
- Produces:

```ts
export interface PolicyRule {
  id: string;
  tier: 'ALLOW' | 'ASK' | 'BLOCK';
  match: { type: 'exact' | 'regex' | 'prefix' | 'path'; pattern: string };
  reason: string;
}
export interface HarnessConfig {
  llm: { provider: 'mock' | 'openai-compat'; baseURL?: string; model?: string };
  workspace: string;
  policy: PolicyRule[];
  tools: { enabled: string[] };
  sandbox: 'fence-only' | 'docker';
  budget: { maxSteps: number; maxFailures: number };
  memory: { filePath: string };
  console: { port: number; host: string };
}
export class ConfigError extends Error { readonly field?: string; }
export function defaultConfig(): HarnessConfig;
export function loadConfig(filePath: string): HarnessConfig;
export function validateConfig(raw: unknown): HarnessConfig;
```

默认值：`{ llm:{provider:'mock'}, workspace:'.', policy:[], tools:{enabled:['read_file','write_file','run_command','run_tests','run_typecheck','run_lint','done']}, sandbox:'fence-only', budget:{maxSteps:15, maxFailures:5}, memory:{filePath:'./.harness-memory.jsonl'}, console:{port:8117, host:'127.0.0.1'} }`。

- [ ] **Step 1: 写失败测试 `tests/config/config.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/config/config.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/config/config.ts`：

```ts
import { readFileSync } from 'node:fs';

export interface PolicyRule {
  id: string;
  tier: 'ALLOW' | 'ASK' | 'BLOCK';
  match: { type: 'exact' | 'regex' | 'prefix' | 'path'; pattern: string };
  reason: string;
}
export interface HarnessConfig {
  llm: { provider: 'mock' | 'openai-compat'; baseURL?: string; model?: string };
  workspace: string;
  policy: PolicyRule[];
  tools: { enabled: string[] };
  sandbox: 'fence-only' | 'docker';
  budget: { maxSteps: number; maxFailures: number };
  memory: { filePath: string };
  console: { port: number; host: string };
}

export class ConfigError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const VALID_TOOLS = ['read_file', 'write_file', 'run_command', 'run_tests', 'run_typecheck', 'run_lint', 'done'];

export function defaultConfig(): HarnessConfig {
  return {
    llm: { provider: 'mock' },
    workspace: '.',
    policy: [],
    tools: { enabled: [...VALID_TOOLS] },
    sandbox: 'fence-only',
    budget: { maxSteps: 15, maxFailures: 5 },
    memory: { filePath: './.harness-memory.jsonl' },
    console: { port: 8117, host: '127.0.0.1' },
  };
}

export function validateConfig(raw: unknown): HarnessConfig {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError('config must be an object');
  const r = raw as Record<string, any>;
  if (r.budget && (typeof r.budget.maxSteps !== 'number' || r.budget.maxSteps < 1)) {
    throw new ConfigError('budget.maxSteps must be >= 1', 'budget.maxSteps');
  }
  if (r.budget && (typeof r.budget.maxFailures !== 'number' || r.budget.maxFailures < 1)) {
    throw new ConfigError('budget.maxFailures must be >= 1', 'budget.maxFailures');
  }
  if (r.sandbox && !['fence-only', 'docker'].includes(r.sandbox)) {
    throw new ConfigError('sandbox must be "fence-only" or "docker"', 'sandbox');
  }
  const def = defaultConfig();
  const llm = { ...def.llm, ...(r.llm ?? {}) };
  if (!['mock', 'openai-compat'].includes(llm.provider)) {
    throw new ConfigError('llm.provider must be "mock" or "openai-compat"', 'llm.provider');
  }
  const tools = { enabled: (r.tools?.enabled ?? def.tools.enabled).filter((t: unknown) => typeof t === 'string' && VALID_TOOLS.includes(t)) };
  const workspace = typeof r.workspace === 'string' ? r.workspace : def.workspace;
  return { ...def, ...r, llm, tools, workspace, policy: Array.isArray(r.policy) ? r.policy : [] };
}

export function loadConfig(filePath: string): HarnessConfig {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new ConfigError(`cannot read config ${filePath}: ${(e as Error).message}`, 'file');
  }
  try {
    return validateConfig(JSON.parse(text));
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`invalid JSON in ${filePath}: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/config/config.test.ts`
Expected: PASS。

- [x] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**（T2 commit `9037ec1`，`npm test` 5/5 通过，`npm run build` 通过）

```bash
git add src/config tests/config
git commit -m "feat(T2): config load/validate with defaults"
```

---

## Task 3: Secret 模块（主密码加密文件）

**Files:**
- Create: `src/secret/crypto.ts`, `src/secret/store.ts`, `tests/secret/store.test.ts`

**Interfaces:**
- Consumes: 无（仅 Node 内置 `crypto/fs/path`）。
- Produces:

```ts
export class SecretStore {
  constructor(filePath: string);
  isInitialized(): Promise<boolean>;
  init(masterPassword: string): Promise<void>;
  unlock(masterPassword: string): Promise<void>;
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | null>;
  unset(name: string): Promise<void>;
  list(): Promise<Array<{ name: string; masked: string }>>;
}
export class SecretError extends Error {}
```

- 文件格式（`secrets.json`，`mode: 0o600`）：`{ "version": 1, "kdf": "scrypt", "salt": "<b64>", "check": { "ct": "<b64>", "iv": "<b64>" }, "entries": { "<name>": { "ct": "<b64>", "iv": "<b64>" } } }`。
- 密钥 = `scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 })`；`check` 字段加密自固定字符串 `"ok"`，用于 `unlock` 验证主密码。`masked` = `'••••' + value.slice(-4)`。

- [ ] **Step 1: 写失败测试 `tests/secret/store.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, SecretError } from '../../src/secret/store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ai4se-sec-'));
const pw = 'correct-horse-battery';

describe('SecretStore', () => {
  it('round-trips set/get with correct master password', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    expect(await s.get('openai')).toBe('sk-abc12345');
    const s2 = new SecretStore(p);
    await s2.unlock(pw);
    expect(await s2.get('openai')).toBe('sk-abc12345');
  });
  it('rejects wrong master password on unlock', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    const s2 = new SecretStore(p);
    await expect(s2.unlock('wrong-password')).rejects.toThrow(SecretError);
  });
  it('does not store plaintext on disk', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    const raw = readFileSync(p, 'utf8');
    expect(raw).not.toContain('sk-abc12345');
  });
  it('masks values in list()', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    const [entry] = await s.list();
    expect(entry.masked).toContain('2345'); // 末4位，符合 SPEC "••••末4位"
    expect(entry.masked).not.toContain('abc');
  });
  it('unset removes entry', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-x');
    await s.unset('openai');
    expect(await s.get('openai')).toBeNull();
  });
  it('isInitialized reflects file existence', async () => {
    const p = join(dir(), 'secrets.json');
    expect(await new SecretStore(p).isInitialized()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/secret/store.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/secret/crypto.ts`：

```ts
import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number, o: object) => Promise<Buffer>;

export const N = 16384, R = 8, P = 1;
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, 32, { N, r: R, p: P });
}
export interface Encrypted { ct: string; iv: string; }
export function encrypt(key: Buffer, plain: string): Encrypted {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return { ct: Buffer.concat([enc, tag]).toString('base64'), iv: iv.toString('base64') };
}
export function decrypt(key: Buffer, e: Encrypted): string {
  const iv = Buffer.from(e.iv, 'base64');
  const buf = Buffer.from(e.ct, 'base64');
  const enc = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
```

`src/secret/store.ts`：

```ts
import { randomBytes, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { deriveKey, encrypt, decrypt, Encrypted } from './crypto.js';

export class SecretError extends Error {
  constructor(m: string) { super(m); this.name = 'SecretError'; }
}

interface FileShape {
  version: number; kdf: 'scrypt'; salt: string;
  check: Encrypted; entries: Record<string, Encrypted>;
}

export class SecretStore {
  private key: Buffer | null = null;
  constructor(private readonly filePath: string) {}

  async isInitialized(): Promise<boolean> { return existsSync(this.filePath); }

  private async requireKey(): Promise<Buffer> {
    if (!this.key) throw new SecretError('store is locked; call unlock() or init() first');
    return this.key;
  }

  private load(): FileShape {
    if (!existsSync(this.filePath)) throw new SecretError('secret file not found; run init() first');
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as FileShape;
  }

  private save(shape: FileShape): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(shape, null, 2), { mode: 0o600 });
  }

  async init(masterPassword: string): Promise<void> {
    if (existsSync(this.filePath)) throw new SecretError('already initialized');
    const salt = randomBytes(16);
    const key = await deriveKey(masterPassword, salt);
    const check = encrypt(key, 'ok');
    this.save({ version: 1, kdf: 'scrypt', salt: salt.toString('base64'), check, entries: {} });
    this.key = key;
  }

  async unlock(masterPassword: string): Promise<void> {
    const shape = this.load();
    const salt = Buffer.from(shape.salt, 'base64');
    const key = await deriveKey(masterPassword, salt);
    try {
      decrypt(key, shape.check);
    } catch {
      throw new SecretError('wrong master password');
    }
    this.key = key;
  }

  async set(name: string, value: string): Promise<void> {
    const key = await this.requireKey();
    const shape = this.load();
    shape.entries[name] = encrypt(key, value);
    this.save(shape);
  }

  async get(name: string): Promise<string | null> {
    const key = await this.requireKey();
    const shape = this.load();
    const e = shape.entries[name];
    if (!e) return null;
    try { return decrypt(key, e); } catch { throw new SecretError('decryption failed'); }
  }

  async unset(name: string): Promise<void> {
    await this.requireKey();
    const shape = this.load();
    delete shape.entries[name];
    this.save(shape);
  }

  async list(): Promise<Array<{ name: string; masked: string }>> {
    const key = await this.requireKey();
    const shape = this.load();
    return Object.entries(shape.entries).map(([name, e]) => {
      const v = decrypt(key, e);
      return { name, masked: `••••${v.slice(-4)}` };
    });
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/secret/store.test.ts`
Expected: PASS。

- [x] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**（T3 commit `43794d1`，6/6 通过，build 通过）

```bash
git add src/secret tests/secret
git commit -m "feat(T3): master-password encrypted SecretStore (scrypt + AES-256-GCM)"
```

---

## Task 4: LLM 抽象层（接口 + Mock + OpenAI 兼容 + 解码）

**Files:**
- Create: `src/llm/client.ts`, `src/llm/decode.ts`, `src/llm/mock.ts`, `src/llm/openai.ts`, `tests/llm/decode.test.ts`, `tests/llm/mock.test.ts`, `tests/llm/openai.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`（`AgentAction`）。
- Produces:

```ts
// client.ts
export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface LLMResult { content: string; id: string; }
export interface LLMClient {
  complete(messages: LLMMessage[], opts?: { signal?: AbortSignal }): Promise<LLMResult>;
}

// decode.ts
export class FormatError extends Error {}
export function decodeAction(content: string): AgentAction; // 解析 {"tool":string,"args":object}

// mock.ts
export type MockScript = string | ((messages: LLMMessage[]) => string);
export class MockLLM implements LLMClient {
  constructor(scripts: MockScript[]);
  complete(messages: LLMMessage[]): Promise<LLMResult>; // 脚本耗尽 → 抛 FormatError('mock scripts exhausted')
}

// openai.ts
export interface OpenAICompatOptions {
  baseURL: string; apiKey: string; model: string;
  timeoutMs?: number; maxRetries?: number; fetchImpl?: typeof fetch;
}
export class OpenAICompatClient implements LLMClient {
  constructor(opts: OpenAICompatOptions);
  complete(messages: LLMMessage[], opts?: { signal?: AbortSignal }): Promise<LLMResult>;
}
```

- [ ] **Step 1: 写失败测试（三组）**

`tests/llm/decode.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { decodeAction, FormatError } from '../../src/llm/decode.js';

describe('decodeAction', () => {
  it('parses a valid action', () => {
    const a = decodeAction('{"tool":"run_command","args":{"command":"npm test"}}');
    expect(a.tool).toBe('run_command');
    expect(a.args.command).toBe('npm test');
  });
  it('throws FormatError on invalid JSON', () => {
    expect(() => decodeAction('not json')).toThrow(FormatError);
  });
  it('throws FormatError when tool is missing', () => {
    expect(() => decodeAction('{"args":{}}')).toThrow(FormatError);
  });
});
```

`tests/llm/mock.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { MockLLM } from '../../src/llm/mock.js';

describe('MockLLM', () => {
  it('replays scripted responses in order', async () => {
    const llm = new MockLLM(['first', 'second']);
    expect((await llm.complete([])).content).toBe('first');
    expect((await llm.complete([])).content).toBe('second');
  });
  it('calls function scripts with message history', async () => {
    const seen: string[] = [];
    const llm = new MockLLM([(messages) => { seen.push(messages.map(m => m.content).join('|')); return 'x'; }]);
    await llm.complete([{ role: 'user', content: 'task' }]);
    expect(seen[0]).toContain('task');
  });
  it('fails clearly when scripts are exhausted', async () => {
    const llm = new MockLLM(['only']);
    await llm.complete([]);
    await expect(llm.complete([])).rejects.toThrow(/exhausted/);
  });
});
```

`tests/llm/openai.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { OpenAICompatClient } from '../../src/llm/openai.js';

function fakeFetch(content: string) {
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'cmpl-1', choices: [{ message: { content: `${content}:${body.model}:${body.messages.length}` } }] }),
    } as unknown as Response;
  };
}

describe('OpenAICompatClient', () => {
  it('posts chat/completions with bearer auth and returns content', async () => {
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1', apiKey: 'k-test', model: 'm-1', fetchImpl: fakeFetch('echo'),
    });
    const res = await client.complete([{ role: 'user', content: 'hi' }]);
    expect(res.content).toBe('echo:m-1:1');
    expect(res.id).toBe('cmpl-1');
  });
  it('retries on 5xx up to maxRetries', async () => {
    let calls = 0;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 500 } as unknown as Response;
      return fakeFetch('echo')('', init) as Promise<Response>;
    };
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1', apiKey: 'k', model: 'm', maxRetries: 3, fetchImpl,
    });
    await expect(client.complete([])).resolves.toMatchObject({ content: 'echo:m:0' });
    expect(calls).toBe(3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/llm`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/llm/client.ts`：

```ts
export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface LLMResult { content: string; id: string; }
export interface LLMClient {
  complete(messages: LLMMessage[], opts?: { signal?: AbortSignal }): Promise<LLMResult>;
}
```

`src/llm/decode.ts`：

```ts
import type { AgentAction } from '../types.js';

export class FormatError extends Error {
  constructor(m: string) { super(m); this.name = 'FormatError'; }
}

export function decodeAction(content: string): AgentAction {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new FormatError('action is not valid JSON'); }
  const a = parsed as Partial<AgentAction>;
  if (typeof a?.tool !== 'string' || typeof a.args !== 'object' || a.args === null) {
    throw new FormatError('action must have string tool and object args');
  }
  return { tool: a.tool, args: a.args as Record<string, unknown> };
}
```

`src/llm/mock.ts`：

```ts
import type { LLMClient, LLMMessage, LLMResult } from './client.js';
import { FormatError } from './decode.js';

export type MockScript = string | ((messages: LLMMessage[]) => string);

export class MockLLM implements LLMClient {
  private i = 0;
  constructor(private readonly scripts: MockScript[]) {}
  async complete(messages: LLMMessage[]): Promise<LLMResult> {
    const script = this.scripts[this.i++];
    if (script === undefined) throw new FormatError('mock scripts exhausted');
    const content = typeof script === 'function' ? script(messages) : script;
    return { content, id: `mock-${this.i}` };
  }
}
```

`src/llm/openai.ts`：

```ts
import type { LLMClient, LLMMessage, LLMResult } from './client.js';

export interface OpenAICompatOptions {
  baseURL: string; apiKey: string; model: string;
  timeoutMs?: number; maxRetries?: number; fetchImpl?: typeof fetch;
}

export class OpenAICompatClient implements LLMClient {
  constructor(private readonly opts: OpenAICompatOptions) {}

  async complete(messages: LLMMessage[], opts?: { signal?: AbortSignal }): Promise<LLMResult> {
    const { baseURL, apiKey, model, maxRetries = 3, fetchImpl = fetch } = this.opts;
    const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
    let last: Error = new Error('llm request failed');
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages }),
        signal: opts?.signal,
      });
      if (!res.ok) { last = new Error(`llm http ${res.status}`); continue; }
      const data = (await res.json()) as { id: string; choices: Array<{ message: { content: string } }> };
      return { content: data.choices[0]?.message?.content ?? '', id: data.id };
    }
    throw last;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/llm`
Expected: PASS。

- [x] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**（T4 commit `76e5ebd`，8/8 通过，build 通过）

```bash
git add src/llm tests/llm
git commit -m "feat(T4): LLM abstraction (MockLLM, OpenAI-compat, action decoder)"
```

---

## Task 5: 工具层（Tool 接口 + 注册表 + 文件/命令工具）

**Files:**
- Create: `src/tools/registry.ts`, `src/tools/file.ts`, `src/tools/run.ts`, `tests/tools/registry.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`；类型仅引用 `src/governance/scope.ts` 的 `ScopeFence` 与 `src/governance/executor.ts` 的 `ProcessExecutor`（这两个类由 T6b/T6c 提供；建议先合入 T6b/T6c 再实现本 task，或本 task 在同 worktree 内临时最小实现，最终一致性以合入顺序为准）。
- Produces:

```ts
// registry.ts
export interface ToolContext { scope: ScopeFence; executor: ProcessExecutor; workdir: string; }
export interface Tool {
  name: string;
  schema: Record<string, 'string' | 'number' | 'boolean'>;
  invoke(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
export class ToolError extends Error {}
export class ToolRegistry {
  register(tool: Tool): void;
  has(name: string): boolean;
  dispatch(action: AgentAction, ctx: ToolContext): Promise<ToolResult>;
}

// file.ts
export const readFileTool: Tool;  // args {path} → ctx.scope.resolve 后读取
export const writeFileTool: Tool; // args {path, content} → resolve + 原子写（临时文件 rename）

// run.ts
export const runCommandTool: Tool;   // args {command} → ctx.executor.run(command, {cwd:ctx.workdir, timeoutMs:30_000, maxOutputBytes:1_000_000, envFilter:/AI4SE_|SECRET|KEY|TOKEN|PASSWORD/i})
export const runTestsTool: Tool;     // 执行 `node --test`（cwd=workdir）
export const runTypecheckTool: Tool; // 执行 `npx tsc --noEmit`
export const runLintTool: Tool;      // 执行 `npm run lint`（失败即非 PASS）
export const doneTool: Tool;         // args {summary} → ok:true
```

- 所有 `invoke` **绝不 throw**：`try/catch` 返回 `{ok:false, error}`。

- [ ] **Step 1: 写失败测试 `tests/tools/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, ToolError, ToolContext } from '../../src/tools/registry.js';
import { readFileTool, writeFileTool } from '../../src/tools/file.js';
import { runCommandTool, doneTool } from '../../src/tools/run.js';
import { ScopeFence } from '../../src/governance/scope.js';
import { ProcessExecutor } from '../../src/governance/executor.js';

function ctx(scope: ScopeFence): ToolContext {
  return { scope, executor: new ProcessExecutor(), workdir: scope.getRoots()[0] };
}

describe('ToolRegistry', () => {
  it('registers and dispatches built-in tools', async () => {
    const reg = new ToolRegistry();
    [readFileTool, writeFileTool, runCommandTool, doneTool].forEach(t => reg.register(t));
    expect(reg.has('read_file')).toBe(true);
  });
  it('rejects unknown tools with ToolError', async () => {
    const reg = new ToolRegistry();
    await expect(reg.dispatch({ tool: 'nope', args: {} }, {} as ToolContext)).rejects.toThrow(ToolError);
  });
  it('write_file then read_file round-trips inside scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-tools-'));
    const scope = new ScopeFence([dir]);
    const reg = new ToolRegistry();
    reg.register(writeFileTool);
    reg.register(readFileTool);
    const c = ctx(scope);
    const w = await reg.dispatch({ tool: 'write_file', args: { path: 'a.txt', content: 'hello' } }, c);
    expect(w.ok).toBe(true);
    const r = await reg.dispatch({ tool: 'read_file', args: { path: 'a.txt' } }, c);
    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe('hello');
  });
  it('write_file rejects paths escaping the scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-tools-'));
    const scope = new ScopeFence([dir]);
    const reg = new ToolRegistry();
    reg.register(writeFileTool);
    const res = await reg.dispatch({ tool: 'write_file', args: { path: '../escape.txt', content: 'x' } }, ctx(scope));
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/scope|outside/i);
  });
  it('run_command returns structured result and filters secret env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-tools-'));
    const scope = new ScopeFence([dir]);
    process.env.SECRET_TOKEN = 'should-not-leak';
    const res = await runCommandTool.invoke(
      { command: `node -e "console.log(process.env.SECRET_TOKEN ?? 'missing')"` }, ctx(scope));
    expect(res.ok).toBe(true);
    expect(res.output.trim()).toBe('missing');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/tools/registry.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/tools/registry.ts`：

```ts
import type { AgentAction, ToolResult } from '../types.js';
import type { ScopeFence } from '../governance/scope.js';
import type { ProcessExecutor } from '../governance/executor.js';

export interface ToolContext { scope: ScopeFence; executor: ProcessExecutor; workdir: string; }
export interface Tool {
  name: string;
  schema: Record<string, 'string' | 'number' | 'boolean'>;
  invoke(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
export class ToolError extends Error {
  constructor(m: string) { super(m); this.name = 'ToolError'; }
}
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(tool: Tool) { this.tools.set(tool.name, tool); }
  has(name: string) { return this.tools.has(name); }
  async dispatch(action: AgentAction, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(action.tool);
    if (!tool) throw new ToolError(`unknown tool: ${action.tool}`);
    for (const [k, type] of Object.entries(tool.schema)) {
      const v = action.args[k];
      if (v === undefined) return { ok: false, output: '', exitCode: null, error: `missing arg: ${k}` };
      if (typeof v !== type) return { ok: false, output: '', exitCode: null, error: `arg ${k} must be ${type}` };
    }
    try { return await tool.invoke(action.args, ctx); }
    catch (e) { return { ok: false, output: '', exitCode: null, error: (e as Error).message }; }
  }
}
```

`src/tools/file.ts`：

```ts
import { readFile, writeFile, rename } from 'node:fs/promises';
import type { Tool } from './registry.js';

export const readFileTool: Tool = {
  name: 'read_file',
  schema: { path: 'string' },
  async invoke(input, ctx) {
    const p = ctx.scope.resolve(String(input.path));
    try {
      const content = await readFile(p, 'utf8');
      return { ok: true, output: content, exitCode: 0 };
    } catch (e) {
      return { ok: false, output: '', exitCode: 1, error: (e as Error).message };
    }
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  schema: { path: 'string', content: 'string' },
  async invoke(input, ctx) {
    const p = ctx.scope.resolve(String(input.path));
    const tmp = `${p}.tmp-${process.pid}`;
    try {
      await writeFile(tmp, String(input.content), 'utf8');
      await rename(tmp, p);
      return { ok: true, output: `wrote ${p}`, exitCode: 0 };
    } catch (e) {
      return { ok: false, output: '', exitCode: 1, error: (e as Error).message };
    }
  },
};
```

`src/tools/run.ts`：

```ts
import type { Tool, ToolContext } from './registry.js';
import type { ToolResult } from '../types.js';

const RUN_OPTS = { timeoutMs: 30_000, maxOutputBytes: 1_000_000, envFilter: /AI4SE_|SECRET|KEY|TOKEN|PASSWORD/i };

async function runCommand(ctx: ToolContext, command: string): Promise<ToolResult> {
  try {
    const r = await ctx.executor.run(command, { cwd: ctx.workdir, ...RUN_OPTS });
    const ok = r.exitCode === 0 && !r.timedOut;
    return { ok, output: r.stdout, exitCode: r.exitCode, error: r.timedOut ? 'timed out' : r.stderr };
  } catch (e) {
    return { ok: false, output: '', exitCode: 1, error: (e as Error).message };
  }
}

export const runCommandTool: Tool = {
  name: 'run_command',
  schema: { command: 'string' },
  invoke: (input, ctx) => runCommand(ctx, String(input.command)),
};
export const runTestsTool: Tool = {
  name: 'run_tests',
  schema: {},
  invoke: (_input, ctx) => runCommand(ctx, 'node --test'),
};
export const runTypecheckTool: Tool = {
  name: 'run_typecheck',
  schema: {},
  invoke: (_input, ctx) => runCommand(ctx, 'npx tsc --noEmit'),
};
export const runLintTool: Tool = {
  name: 'run_lint',
  schema: {},
  invoke: (_input, ctx) => runCommand(ctx, 'npm run lint'),
};
export const doneTool: Tool = {
  name: 'done',
  schema: { summary: 'string' },
  invoke: async (input) => ({ ok: true, output: `done: ${String(input.summary)}`, exitCode: 0 }),
};
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tools/registry.test.ts`
Expected: PASS。

- [x] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**（T5 commit `632bd46`，5/5 通过，build 通过）

```bash
git add src/tools tests/tools
git commit -m "feat(T5): Tool interface, registry, file/run tools"
```

---

## Task 6a: 治理 · 护栏规则引擎（GuardrailEngine）

**Files:**
- Create: `src/governance/guardrail.ts`, `tests/governance/guardrail.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`（`AgentAction`、`Decision`、`Tier`）。
- Produces:

```ts
export type RuleMatchType = 'exact' | 'regex' | 'prefix' | 'path';
export interface PolicyRule {
  id: string; tier: 'ALLOW' | 'ASK' | 'BLOCK';
  match: { type: RuleMatchType; pattern: string }; reason: string;
}
export class PolicyError extends Error {}
export class GuardrailEngine {
  constructor(rules: PolicyRule[]);
  decide(action: AgentAction): Decision;
  static validate(rules: PolicyRule[]): void; // 非法 regex / 空 id / 非法 tier → PolicyError
}
```

- 匹配语义：`run_command` 的匹配目标 = `String(args.command)`，其余工具 = 工具名；`path` 型规则匹配 `args.path`（无 path 则不命中）。命中规则按优先级取最高 tier（BLOCK>ASK>ALLOW），同级取第一条；无命中 → `{tier:'ALLOW', reason:'no rule matched'}`。

- [ ] **Step 1: 写失败测试 `tests/governance/guardrail.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/governance/guardrail.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/governance/guardrail.ts`：

```ts
import type { AgentAction, Decision, Tier } from '../types.js';

export type RuleMatchType = 'exact' | 'regex' | 'prefix' | 'path';
export interface PolicyRule {
  id: string; tier: Tier;
  match: { type: RuleMatchType; pattern: string }; reason: string;
}
export class PolicyError extends Error {
  constructor(m: string) { super(m); this.name = 'PolicyError'; }
}

function signatureOf(a: AgentAction): string {
  return a.tool === 'run_command' ? String(a.args.command ?? '') : a.tool;
}
function matches(rule: PolicyRule, sig: string, pathArg: string | undefined): boolean {
  switch (rule.match.type) {
    case 'exact': return sig === rule.match.pattern;
    case 'prefix': return sig.startsWith(rule.match.pattern);
    case 'regex': {
      try { return new RegExp(rule.match.pattern).test(sig); } catch { return false; }
    }
    case 'path': return pathArg !== undefined && new RegExp(rule.match.pattern).test(pathArg);
  }
}

export class GuardrailEngine {
  constructor(private readonly rules: PolicyRule[]) { GuardrailEngine.validate(this.rules); }

  decide(action: AgentAction): Decision {
    const sig = signatureOf(action);
    const pathArg = typeof action.args.path === 'string' ? action.args.path : undefined;
    const tierOrder: Record<Tier, number> = { BLOCK: 3, ASK: 2, ALLOW: 1 };
    let best: PolicyRule | undefined;
    for (const r of this.rules) {
      if (!matches(r, sig, pathArg)) continue;
      if (!best || tierOrder[r.tier] > tierOrder[best.tier]) best = r;
    }
    return best
      ? { tier: best.tier, ruleId: best.id, reason: best.reason }
      : { tier: 'ALLOW', reason: 'no rule matched' };
  }

  static validate(rules: PolicyRule[]): void {
    for (const r of rules) {
      if (!r.id) throw new PolicyError('rule id is required');
      if (!['ALLOW', 'ASK', 'BLOCK'].includes(r.tier)) throw new PolicyError(`invalid tier on rule ${r.id}`);
      if (!['exact', 'regex', 'prefix', 'path'].includes(r.match.type)) throw new PolicyError(`invalid match type on rule ${r.id}`);
      if (r.match.type === 'regex') {
        try { new RegExp(r.match.pattern); } catch { throw new PolicyError(`invalid regex on rule ${r.id}`); }
      }
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/governance/guardrail.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/governance/guardrail.ts tests/governance/guardrail.test.ts
git commit -m "feat(T6a): GuardrailEngine rule engine with tier priority"
```

---

## Task 6b: 治理 · 范围围栏（ScopeFence）

**Files:**
- Create: `src/governance/scope.ts`, `tests/governance/scope.test.ts`

**Interfaces:**
- Consumes: Node 内置 `fs/path/os`。
- Produces:

```ts
export class ScopeViolationError extends Error {}
export class ScopeFence {
  constructor(roots: string[]);
  resolve(target: string): string; // 返回规范化绝对路径；越界 → ScopeViolationError
  getRoots(): string[];
}
```

- 实现要点：roots 先绝对化 + `realpath`（存在时）；`resolve(target)` = `realpath(path.resolve(root, target))`，比较时 win32 忽略大小写；target 含 `..` 逃逸、符号链接逃逸到 root 外 → 抛 `ScopeViolationError`。

- [ ] **Step 1: 写失败测试 `tests/governance/scope.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeFence, ScopeViolationError } from '../../src/governance/scope.js';

function makeRoot(): string { return mkdtempSync(join(tmpdir(), 'ai4se-scope-')); }

describe('ScopeFence', () => {
  it('resolves a path inside the root', () => {
    const root = makeRoot();
    const f = new ScopeFence([root]);
    expect(f.resolve('a/b.txt').startsWith(f.getRoots()[0])).toBe(true);
  });
  it('rejects parent traversal', () => {
    const root = makeRoot();
    const f = new ScopeFence([root]);
    expect(() => f.resolve('../outside.txt')).toThrow(ScopeViolationError);
  });
  it('rejects absolute paths outside the root', () => {
    const root = makeRoot();
    const f = new ScopeFence([root]);
    expect(() => f.resolve(join(tmpdir(), 'elsewhere.txt'))).toThrow(ScopeViolationError);
  });
  it('rejects symlink escaping the root when symlinks are supported', () => {
    const outside = makeRoot();
    const root = makeRoot();
    const link = join(root, 'escape');
    try {
      symlinkSync(outside, link, 'junction');
    } catch {
      return; // 平台/权限不允许时跳过
    }
    const f = new ScopeFence([root]);
    expect(() => f.resolve('escape')).toThrow(ScopeViolationError);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/governance/scope.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/governance/scope.ts`：

```ts
import { realpathSync, existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { platform } from 'node:os';

export class ScopeViolationError extends Error {
  constructor(target: string) {
    super(`path is outside the allowed scope: ${target}`);
    this.name = 'ScopeViolationError';
  }
}

const isWin = platform() === 'win32';

export class ScopeFence {
  private readonly canonicalRoots: string[];

  constructor(roots: string[]) {
    this.canonicalRoots = roots.map(r => {
      const abs = isAbsolute(r) ? r : resolve(r);
      return existsSync(abs) ? realpathSync(abs) : abs;
    });
  }

  getRoots(): string[] { return [...this.canonicalRoots]; }

  resolve(target: string): string {
    const abs = isAbsolute(target) ? target : resolve(this.canonicalRoots[0], target);
    const canon = existsSync(abs) ? realpathSync(abs) : abs;
    const norm = (p: string) => (isWin ? p.toLowerCase() : p);
    const ok = this.canonicalRoots.some(root => {
      const base = norm(root.endsWith(sep) ? root : root + sep);
      return norm(canon) === norm(root) || norm(canon).startsWith(base);
    });
    if (!ok) throw new ScopeViolationError(target);
    return canon;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/governance/scope.test.ts`
Expected: PASS。

- [x] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**（T6b commit `cc11eaf`，4/4 通过，build 通过）

```bash
git add src/governance/scope.ts tests/governance/scope.test.ts
git commit -m "feat(T6b): ScopeFence canonicalized path guardrail"
```

---

## Task 6c: 治理 · 进程执行器（ProcessExecutor）

**Files:**
- Create: `src/governance/split.ts`, `src/governance/executor.ts`, `tests/governance/executor.test.ts`

**Interfaces:**
- Consumes: Node 内置 `child_process`。
- Produces:

```ts
// split.ts
export function splitCommand(cmd: string): string[]; // 引号感知分词（支持单双引号）

// executor.ts
export interface ExecOptions { cwd: string; timeoutMs: number; maxOutputBytes: number; envFilter: RegExp; }
export interface ExecResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; }
export class ProcessExecutor {
  run(command: string, opts: ExecOptions): Promise<ExecResult>;
}
```

- 实现要点：`spawn(argv[0], argv.slice(1), { cwd, env: 过滤后的 env, shell: false })`；`stdout/stderr` 超过 `maxOutputBytes` 截断；`timeoutMs` 到点 `kill` 并置 `timedOut`；退出码与输出结构化返回。**抛错仅限 spawn 本身失败**（如 cwd 不存在、命令不存在）。

- [ ] **Step 1: 写失败测试 `tests/governance/executor.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { ProcessExecutor } from '../../src/governance/executor.js';
import { splitCommand } from '../../src/governance/split.js';

const opts = () => ({
  cwd: tmpdir(), timeoutMs: 5000, maxOutputBytes: 1024 * 1024,
  envFilter: /AI4SE_|SECRET|KEY|TOKEN|PASSWORD/i,
});

describe('splitCommand', () => {
  it('splits respecting quotes', () => {
    expect(splitCommand(`node -e "console.log('a b')"`)).toEqual(['node', '-e', `console.log('a b')`]);
  });
});

describe('ProcessExecutor', () => {
  it('captures stdout and exit code', async () => {
    const r = await new ProcessExecutor().run(`node -e "console.log('hi')"`, opts());
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hi');
  });
  it('captures non-zero exit code', async () => {
    const r = await new ProcessExecutor().run(`node -e "process.exit(3)"`, opts());
    expect(r.exitCode).toBe(3);
  });
  it('filters environment variables matching envFilter', async () => {
    process.env.SECRET_TOKEN = 'leak';
    const r = await new ProcessExecutor().run(
      `node -e "console.log(process.env.SECRET_TOKEN ?? 'missing')"`, opts());
    expect(r.stdout.trim()).toBe('missing');
  });
  it('times out and kills the child', async () => {
    const r = await new ProcessExecutor().run(
      `node -e "setTimeout(()=>{}, 10000)"`, { ...opts(), timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
  });
  it('rejects when spawn fails (missing cwd)', async () => {
    await expect(new ProcessExecutor().run('node -e "1"', { ...opts(), cwd: '/nonexistent-dir-xyz' }))
      .rejects.toThrow();
  });
}, 10000);
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/governance/executor.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/governance/split.ts`：

```ts
export function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  const cur: string[] = [];
  let quote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur.push(ch);
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length) { out.push(cur.join('')); cur.length = 0; }
    } else {
      cur.push(ch);
    }
  }
  if (quote) throw new Error('unterminated quote in command');
  if (cur.length) out.push(cur.join(''));
  return out;
}
```

`src/governance/executor.ts`：

```ts
import { spawn } from 'node:child_process';
import { splitCommand } from './split.js';

export interface ExecOptions { cwd: string; timeoutMs: number; maxOutputBytes: number; envFilter: RegExp; }
export interface ExecResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; }

export class ProcessExecutor {
  run(command: string, opts: ExecOptions): Promise<ExecResult> {
    return new Promise((resolvePromise, reject) => {
      let args: string[];
      try { args = splitCommand(command); } catch (e) { return reject(e); }
      if (args.length === 0) return reject(new Error('empty command'));
      const env: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !opts.envFilter.test(k)) env[k] = v;
      }
      const child = spawn(args[0], args.slice(1), { cwd: opts.cwd, env, shell: false });
      let stdout = '', stderr = '', outBytes = 0, errBytes = 0;
      let timedOut = false;
      const cap = (buf: Buffer, target: 'stdout' | 'stderr') => {
        const bytes = target === 'stdout' ? outBytes : errBytes;
        if (bytes >= opts.maxOutputBytes) return;
        const room = opts.maxOutputBytes - bytes;
        const chunk = buf.subarray(0, room).toString('utf8');
        if (target === 'stdout') { stdout += chunk; outBytes += Buffer.byteLength(chunk); }
        else { stderr += chunk; errBytes += Buffer.byteLength(chunk); }
      };
      child.stdout?.on('data', (b: Buffer) => cap(b, 'stdout'));
      child.stderr?.on('data', (b: Buffer) => cap(b, 'stderr'));
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, opts.timeoutMs);
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolvePromise({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/governance/executor.test.ts`
Expected: PASS。

- [x] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**（T6c commit `e5f3b8c`，6/6 通过，build 通过）

```bash
git add src/governance/executor.ts src/governance/split.ts tests/governance/executor.test.ts
git commit -m "feat(T6c): ProcessExecutor with timeout, env filter, output cap"
```

---

## Task 6d: 治理 · HITL 审批状态机（HITLStateMachine）

**Files:**
- Create: `src/governance/hitl.ts`, `tests/governance/hitl.test.ts`, `tests/helpers/inmem.ts`

**Interfaces:**
- Consumes: `src/types.ts`（`AgentAction`）。
- Produces:

```ts
export type HITLStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'TIMED_OUT';
export interface ActionRequest {
  id: string; sessionId: string; action: AgentAction;
  status: HITLStatus; createdAt: number; decidedAt?: number; decidedBy?: string; ttlMs: number;
}
export interface RequestStore {
  save(r: ActionRequest): Promise<void>;
  update(r: ActionRequest): Promise<void>;
  get(id: string): Promise<ActionRequest | null>;
  all(): Promise<ActionRequest[]>;
}
export class HITLError extends Error {}
export class HITLStateMachine {
  constructor(store: RequestStore, ttlMs?: number); // 默认 120_000
  request(action: AgentAction, sessionId: string): Promise<ActionRequest>;
  approve(id: string, by: string): Promise<ActionRequest>;
  deny(id: string, by: string): Promise<ActionRequest>;
  timeout(id: string): Promise<ActionRequest>; // PENDING→TIMED_OUT（幂等）；其它状态抛 HITLError
  sweepExpired(now?: number): Promise<ActionRequest[]>;
  get(id: string): Promise<ActionRequest | null>;
}
```

- 语义：仅 `PENDING` 可迁移；`approve` 对已 APPROVED **幂等**返回当前；对 DENIED/TIMED_OUT 抛 `HITLError`；`deny` 同理。

- [ ] **Step 1: 写失败测试**

`tests/helpers/inmem.ts`：

```ts
import type { ActionRequest, RequestStore } from '../../src/governance/hitl.js';

export class InMemoryStore implements RequestStore {
  private m = new Map<string, ActionRequest>();
  async save(r: ActionRequest) { this.m.set(r.id, r); }
  async update(r: ActionRequest) { this.m.set(r.id, r); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async all() { return [...this.m.values()]; }
}
```

`tests/governance/hitl.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { HITLStateMachine, HITLError, ActionRequest } from '../../src/governance/hitl.js';
import { InMemoryStore } from '../helpers/inmem.js';

const action = { tool: 'run_command', args: { command: 'git push' } };
const mk = (ttl = 1000) => new HITLStateMachine(new InMemoryStore(), ttl);

describe('HITLStateMachine', () => {
  it('creates a PENDING request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    expect(req.status).toBe('PENDING');
    expect(req.action).toEqual(action);
  });
  it('approve transitions PENDING to APPROVED', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    const out = await m.approve(req.id, 'console');
    expect(out.status).toBe('APPROVED');
    expect(out.decidedBy).toBe('console');
  });
  it('deny transitions PENDING to DENIED', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    expect((await m.deny(req.id, 'cli')).status).toBe('DENIED');
  });
  it('approve is idempotent on an approved request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    await m.approve(req.id, 'cli');
    const again = await m.approve(req.id, 'cli');
    expect(again.status).toBe('APPROVED');
  });
  it('approve throws on a denied request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    await m.deny(req.id, 'cli');
    await expect(m.approve(req.id, 'cli')).rejects.toThrow(HITLError);
  });
  it('sweepExpired marks overdue requests as TIMED_OUT', async () => {
    const m = mk(50);
    const req = await m.request(action, 's1');
    await m.sweepExpired(Date.now() + 1000);
    const cur = await m.get(req.id);
    expect(cur?.status).toBe('TIMED_OUT');
  });
  it('timeout transitions PENDING to TIMED_OUT and is idempotent', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    expect((await m.timeout(req.id)).status).toBe('TIMED_OUT');
    expect((await m.timeout(req.id)).status).toBe('TIMED_OUT');
  });
  it('timeout throws on an approved request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    await m.approve(req.id, 'cli');
    await expect(m.timeout(req.id)).rejects.toThrow(HITLError);
  });
});
```

注意：`decidedBy` 字段需加入 `ActionRequest`（见接口）。若你在接口中未定义该字段，请把它加上（`decidedBy?: string`）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/governance/hitl.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/governance/hitl.ts`：

```ts
import { randomUUID } from 'node:crypto';
import type { AgentAction } from '../types.js';

export type HITLStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'TIMED_OUT';
export interface ActionRequest {
  id: string; sessionId: string; action: AgentAction;
  status: HITLStatus; createdAt: number; decidedAt?: number; decidedBy?: string; ttlMs: number;
}
export interface RequestStore {
  save(r: ActionRequest): Promise<void>;
  update(r: ActionRequest): Promise<void>;
  get(id: string): Promise<ActionRequest | null>;
  all(): Promise<ActionRequest[]>; // sweepExpired / list 用
}
export class HITLError extends Error {
  constructor(m: string) { super(m); this.name = 'HITLError'; }
}

export class HITLStateMachine {
  constructor(private readonly store: RequestStore, private readonly ttlMs = 120_000) {}

  async request(action: AgentAction, sessionId: string): Promise<ActionRequest> {
    const req: ActionRequest = {
      id: randomUUID(), sessionId, action, status: 'PENDING',
      createdAt: Date.now(), ttlMs: this.ttlMs,
    };
    await this.store.save(req);
    return req;
  }

  async get(id: string): Promise<ActionRequest | null> { return this.store.get(id); }

  private async transition(id: string, to: 'APPROVED' | 'DENIED' | 'TIMED_OUT', by: string): Promise<ActionRequest> {
    const req = await this.store.get(id);
    if (!req) throw new HITLError(`unknown request: ${id}`);
    if (req.status === to) return req; // 幂等
    if (req.status !== 'PENDING') throw new HITLError(`request ${id} is already ${req.status}`);
    const next: ActionRequest = { ...req, status: to, decidedAt: Date.now(), decidedBy: by };
    await this.store.update(next);
    return next;
  }

  approve(id: string, by: string) { return this.transition(id, 'APPROVED', by); }
  deny(id: string, by: string) { return this.transition(id, 'DENIED', by); }
  timeout(id: string) { return this.transition(id, 'TIMED_OUT', 'system'); }

  async sweepExpired(now = Date.now()): Promise<ActionRequest[]> {
    const expired: ActionRequest[] = [];
    for (const req of await this.store.all()) {
      if (req.status === 'PENDING' && now - req.createdAt > req.ttlMs) {
        expired.push(await this.timeout(req.id));
      }
    }
    return expired;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/governance/hitl.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/governance/hitl.ts tests/governance/hitl.test.ts tests/helpers/inmem.ts
git commit -m "feat(T6d): HITL approval state machine"
```

---

## Task 7: 反馈模块（确定性校验器 + FeedbackClassifier）

**Files:**
- Create: `src/feedback/classifier.ts`, `src/feedback/validators.ts`, `tests/feedback/classifier.test.ts`, `tests/feedback/validators.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`；`src/tools/registry.ts` 的 `ToolContext`；`src/governance/executor.ts` 的 `ProcessExecutor`；`src/governance/scope.ts` 的 `ScopeFence`。
- Produces:

```ts
// classifier.ts
export class FeedbackClassifier {
  classify(toolName: string, result: ToolResult): Feedback;
}
// 规则：exitCode===0 且 !timedOut(经 error 字段判断) 且 stdout 非空/无 error → PASS；
// toolName 以 run_tests 开头且失败 → TEST_FAILURE；run_typecheck → COMPILE_ERROR；run_lint → LINT_ERROR；
// error 含 'timed out' 或 exitCode===null → TIMEOUT；其余失败 → OTHER。

// validators.ts
export function runTests(ctx: ToolContext): Promise<ToolResult>;   // node --test
export function runTypecheck(ctx: ToolContext): Promise<ToolResult>; // npx tsc --noEmit
export function makeParseFileValidator(
  scope: ScopeFence, filePath: string,
  predicate: (content: string) => boolean,
): Promise<ToolResult>; // 读取并断言内容满足 predicate → ok:boolean
```

- [ ] **Step 1: 写失败测试**

`tests/feedback/classifier.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { FeedbackClassifier } from '../../src/feedback/classifier.js';
import type { ToolResult } from '../../src/types.js';

const cls = new FeedbackClassifier();
const r = (over: Partial<ToolResult>): ToolResult => ({ ok: false, output: '', exitCode: 1, error: 'x', ...over });

describe('FeedbackClassifier', () => {
  it('classifies passing tests as PASS', () => {
    expect(cls.classify('run_tests', { ok: true, output: '# pass 1', exitCode: 0 })).toMatchObject({ category: 'PASS' });
  });
  it('classifies failing tests as TEST_FAILURE', () => {
    expect(cls.classify('run_tests', r({ output: 'FAIL', error: '1 failing' })).category).toBe('TEST_FAILURE');
  });
  it('classifies typecheck failure as COMPILE_ERROR', () => {
    expect(cls.classify('run_typecheck', r({ error: 'error TS1000: x' })).category).toBe('COMPILE_ERROR');
  });
  it('classifies lint failure as LINT_ERROR', () => {
    expect(cls.classify('run_lint', r({})).category).toBe('LINT_ERROR');
  });
  it('classifies timeout as TIMEOUT', () => {
    expect(cls.classify('run_command', { ok: false, output: '', exitCode: null, error: 'timed out' }).category).toBe('TIMEOUT');
  });
  it('classifies other failures as OTHER', () => {
    expect(cls.classify('read_file', r({ error: 'ENOENT' })).category).toBe('OTHER');
  });
});
```

`tests/feedback/validators.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeFence } from '../../src/governance/scope.js';
import { ProcessExecutor } from '../../src/governance/executor.js';
import { runTests, makeParseFileValidator } from '../../src/feedback/validators.js';

function ctx(dir: string) {
  return { scope: new ScopeFence([dir]), executor: new ProcessExecutor(), workdir: dir };
}

describe('validators', () => {
  it('runTests detects a failing node:test file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-val-'));
    writeFileSync(join(dir, 'x.test.js'), `const { test } = require('node:test'); const assert = require('node:assert'); test('fails', () => assert.strictEqual(1, 2));`);
    const res = await runTests(ctx(dir));
    expect(res.ok).toBe(false);
  });
  it('makeParseFileValidator asserts file content predicate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-val-'));
    writeFileSync(join(dir, 'a.js'), 'export function f() {}');
    const ok = await makeParseFileValidator(new ScopeFence([dir]), 'a.js', (c) => c.includes('function f'));
    expect(ok.ok).toBe(true);
    const bad = await makeParseFileValidator(new ScopeFence([dir]), 'a.js', (c) => c.includes('function g'));
    expect(bad.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/feedback`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/feedback/classifier.ts`：

```ts
import type { Feedback, FeedbackCategory, ToolResult } from '../types.js';

function timedOut(result: ToolResult): boolean {
  return result.exitCode === null && /timed out/i.test(result.error ?? '');
}

export class FeedbackClassifier {
  classify(toolName: string, result: ToolResult): Feedback {
    let category: FeedbackCategory;
    if (timedOut(result)) category = 'TIMEOUT';
    else if (result.ok && result.exitCode === 0) category = 'PASS';
    else if (toolName === 'run_tests') category = 'TEST_FAILURE';
    else if (toolName === 'run_typecheck') category = 'COMPILE_ERROR';
    else if (toolName === 'run_lint') category = 'LINT_ERROR';
    else category = 'OTHER';
    const detail = result.error ?? result.output.trim().split('\n').slice(0, 10).join('\n');
    return { category, summary: `${category}: ${detail.slice(0, 500)}` };
  }
}
```

`src/feedback/validators.ts`：

```ts
import { readFile } from 'node:fs/promises';
import type { ToolContext } from '../tools/registry.js';
import type { ToolResult } from '../types.js';
import type { ScopeFence } from '../governance/scope.js';

const RUN = { timeoutMs: 30_000, maxOutputBytes: 1_000_000, envFilter: /AI4SE_|SECRET|KEY|TOKEN|PASSWORD/i };

export async function runTests(ctx: ToolContext): Promise<ToolResult> {
  try {
    const r = await ctx.executor.run('node --test', { cwd: ctx.workdir, ...RUN });
    const ok = r.exitCode === 0 && !r.timedOut;
    return { ok, output: r.stdout, exitCode: r.exitCode, error: r.timedOut ? 'timed out' : r.stderr };
  } catch (e) {
    return { ok: false, output: '', exitCode: 1, error: (e as Error).message };
  }
}

export async function runTypecheck(ctx: ToolContext): Promise<ToolResult> {
  try {
    const r = await ctx.executor.run('npx tsc --noEmit', { cwd: ctx.workdir, ...RUN });
    const ok = r.exitCode === 0 && !r.timedOut;
    return { ok, output: r.stdout, exitCode: r.exitCode, error: r.timedOut ? 'timed out' : r.stderr };
  } catch (e) {
    return { ok: false, output: '', exitCode: 1, error: (e as Error).message };
  }
}

export async function makeParseFileValidator(
  scope: ScopeFence, filePath: string,
  predicate: (content: string) => boolean,
): Promise<ToolResult> {
  try {
    const p = scope.resolve(filePath);
    const content = await readFile(p, 'utf8');
    const ok = predicate(content);
    return { ok, output: ok ? 'predicate satisfied' : 'predicate not satisfied', exitCode: ok ? 0 : 1 };
  } catch (e) {
    return { ok: false, output: '', exitCode: 1, error: (e as Error).message };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/feedback`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/feedback tests/feedback
git commit -m "feat(T7): deterministic feedback validators and classifier"
```

---

## Task 8: 记忆模块（MemoryStore，jsonl）

**Files:**
- Create: `src/memory/store.ts`, `tests/memory/store.test.ts`

**Interfaces:**
- Consumes: Node 内置。
- Produces:

```ts
export type MemoryKind = 'task-decision' | 'project-convention' | 'approval-history' | 'error';
export interface MemoryEntry {
  id: string; kind: MemoryKind; content: string; tags: string[]; ts: number;
}
export class MemoryStore {
  constructor(filePath: string);
  add(kind: MemoryKind, content: string, tags?: string[]): Promise<MemoryEntry>;
  query(opts?: { kind?: MemoryKind; keywords?: string[]; limit?: number }): Promise<MemoryEntry[]>;
  all(): Promise<MemoryEntry[]>;
  summary(limit?: number): Promise<string>; // 按 ts 倒序取最近 limit 条拼成文本（仅 content，非全量）
}
```

- 存储：每行一条 JSON（jsonl）；id 用 `randomUUID`。

- [ ] **Step 1: 写失败测试 `tests/memory/store.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../../src/memory/store.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'ai4se-mem-')), 'mem.jsonl');

describe('MemoryStore', () => {
  it('adds and persists entries', async () => {
    const p = file();
    const m = new MemoryStore(p);
    await m.add('project-convention', 'use vitest not jest', ['testing']);
    const m2 = new MemoryStore(p);
    const all = await m2.all();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('use vitest not jest');
  });
  it('queries by kind and keywords', async () => {
    const m = new MemoryStore(file());
    await m.add('project-convention', 'use vitest', ['testing']);
    await m.add('task-decision', 'prefer async/await', ['style']);
    const byKind = await m.query({ kind: 'task-decision' });
    expect(byKind).toHaveLength(1);
    const byKw = await m.query({ keywords: ['vitest'] });
    expect(byKw[0].kind).toBe('project-convention');
  });
  it('summary returns only recent contents, not full dump', async () => {
    const m = new MemoryStore(file());
    await m.add('task-decision', 'AAA', []);
    await m.add('task-decision', 'BBB', []);
    const s = await m.summary(1);
    expect(s).toContain('BBB');
    expect(s).not.toContain('AAA');
  });
  it('empty store summary is empty string', async () => {
    expect(await new MemoryStore(file()).summary()).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/memory/store.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`src/memory/store.ts`：

```ts
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type MemoryKind = 'task-decision' | 'project-convention' | 'approval-history' | 'error';
export interface MemoryEntry { id: string; kind: MemoryKind; content: string; tags: string[]; ts: number; }

export class MemoryStore {
  constructor(private readonly filePath: string) {}

  private ensureFile() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) appendFileSync(this.filePath, '');
  }

  async add(kind: MemoryKind, content: string, tags: string[] = []): Promise<MemoryEntry> {
    this.ensureFile();
    const entry: MemoryEntry = { id: randomUUID(), kind, content, tags, ts: Date.now() };
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  }

  async all(): Promise<MemoryEntry[]> {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as MemoryEntry);
  }

  async query(opts: { kind?: MemoryKind; keywords?: string[]; limit?: number } = {}): Promise<MemoryEntry[]> {
    let rows = await this.all();
    if (opts.kind) rows = rows.filter(r => r.kind === opts.kind);
    if (opts.keywords && opts.keywords.length) {
      rows = rows.filter(r => opts.keywords!.some(kw => r.content.toLowerCase().includes(kw.toLowerCase()) || r.tags.some(t => t.toLowerCase().includes(kw.toLowerCase()))));
    }
    rows.sort((a, b) => b.ts - a.ts);
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  async summary(limit = 10): Promise<string> {
    const rows = await this.query({ limit });
    return rows.map(r => `[${r.kind}] ${r.content}`).join('\n');
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/memory/store.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/memory tests/memory
git commit -m "feat(T8): MemoryStore append-only jsonl with query/summary"
```

---

## Task 9: 主循环（HarnessSession）—— harness 内核核心

**Files:**
- Create: `src/loop/session.ts`, `src/loop/prompt.ts`, `tests/loop/session.test.ts`

**Interfaces:**
- Consumes: T2 `HarnessConfig`；T3 `SecretStore`（不经 loop，供组装方取 key）；T4 `LLMClient` + `decodeAction` + `FormatError`；T5 `ToolRegistry`/`ToolContext`；T6a `GuardrailEngine`；T6b `ScopeFence`；T6c `ProcessExecutor`；T6d `HITLStateMachine`/`ActionRequest`；T7 `FeedbackClassifier`；T8 `MemoryStore`。
- Produces:

```ts
// prompt.ts
export function buildSystemPrompt(config: HarnessConfig): string; // 描述可用工具（name+schema+args 说明）与"只输出一个 JSON 动作对象"协议

// session.ts
export type SessionEvent =
  | { type: 'status'; status: SessionStatus }
  | { type: 'step'; step: StepRecord }
  | { type: 'ask'; requestId: string; action: AgentAction };
export interface SessionReport {
  sessionId: string;
  status: SessionStatus;
  steps: StepRecord[];
  reason: string;
}
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
  resolveApproval?: (req: ActionRequest) => Promise<ActionRequest>; // 默认：轮询 hitl.get 直至决定或超时（调用 hitl.timeout）
  onEvent?: (ev: SessionEvent) => void;
}
export class HarnessSession {
  constructor(deps: SessionDeps);
  abort(): void;
  run(): Promise<SessionReport>;
}
```

- 停机条件：`done` 工具被调用 → done；校验器（run_tests/run_typecheck/run_lint）返回 PASS 且本会话已有过成功的 `write_file` → done；`failures >= config.budget.maxFailures`（连续非 PASS 反馈计数）→ stalled；步数达 `budget.maxSteps` → stalled；`abort()` → aborted。
- 反馈回灌：每条 `StepRecord` 追加进 `messages`（assistant 原文 + `Tool result: ...` + `Feedback: category summary`）；格式化错误/LLM 错误计失败步并回灌 `FORMAT_ERROR`/`OTHER`。
- BLOCK 与 DENIED/TIMED_OUT 均不执行工具，回灌拒绝原因。

- [ ] **Step 1: 写失败测试 `tests/loop/session.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/loop/session.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/loop/prompt.ts`：

```ts
import type { HarnessConfig } from '../config/config.js';

export function buildSystemPrompt(config: HarnessConfig): string {
  const tools = config.tools.enabled.join(', ');
  return [
    'You are a coding agent. You may use the following tools:',
    tools,
    'Respond with ONLY a single JSON object of the form {"tool":"<name>","args":{...}}.',
    'run_tests/run_typecheck/run_lint execute the project validators. Write code, run validators,',
    'read the feedback, and iterate until validators pass, then call the "done" tool with a summary.',
  ].join('\n');
}
```

`src/loop/session.ts`：

```ts
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

async function defaultResolve(hitl: HITLStateMachine) {
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
```

注意：`defaultResolve(hitl)` 返回一个函数；请把它写成一个返回闭包的工厂（如上），或在 `SessionDeps` 中默认注入。`decision` 里的 `decided.status` 与 `ActionRequest.status` 类型一致。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/loop/session.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/loop tests/loop
git commit -m "feat(T9): HarnessSession agent loop with guardrail/feedback/stop logic"
```

---

## Task 10: Web 控制台（Node http + ws，四功能）

**Files:**
- Create: `src/console/server.ts`, `src/console/static/index.html`, `tests/console/server.test.ts`

**Interfaces:**
- Consumes: T9 `SessionEvent`/`SessionStatus`；T3 `SecretStore`；T2 `HarnessConfig`；T11 `SessionRunner`（`startDemo`/`approve`/`deny`/`list`/`onEvent`）——本 task 先定义 `SessionRunner` 接口并提供一个 `FakeRunner` 供测试，T11 实现真实版。
- Produces:

```ts
export interface SessionInfo { sessionId: string; status: SessionStatus; task: string; startedAt: string; }
export interface SessionRunner {
  startDemo(): Promise<string>;
  approve(id: string): Promise<void>;
  deny(id: string): Promise<void>;
  list(): Promise<SessionInfo[]>;
  onEvent(cb: (ev: SessionEvent) => void): () => void;
}
export interface ConsoleServerOptions {
  port: number; host: string;
  runner: SessionRunner; secrets: SecretStore; config: HarnessConfig;
}
export class ConsoleServer {
  constructor(opts: ConsoleServerOptions);
  start(): Promise<void>;
  stop(): Promise<void>;
  get url(): string; // http://host:port（port=0 时取实际端口）
}
```

- API：
  - `GET /` → `src/console/static/index.html`
  - `GET /api/config` → `{ workspace, sandbox, budget, console, policy }`（**无任何 key/密文**）
  - `GET /api/sessions` → `runner.list()`
  - `POST /api/demo/run` → `{ sessionId }`
  - `POST /api/approvals/:id/approve` → 调 `runner.approve(id)`，返回 `{ok:true}`
  - `POST /api/approvals/:id/deny` → 调 `runner.deny(id)`
  - `GET /api/secrets` → `secrets.list()`（掩码）
  - `POST /api/secrets` body `{name, value}` → `secrets.set(name, value)`
  - `DELETE /api/secrets/:name` → `secrets.unset(name)`
  - `WS /ws` → 通过 `runner.onEvent` 把 `SessionEvent` 广播给所有连接客户端

- [ ] **Step 1: 写失败测试 `tests/console/server.test.ts`**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleServer, SessionRunner, SessionInfo } from '../../src/console/server.js';
import { SecretStore } from '../../src/secret/store.js';
import { HarnessConfig, defaultConfig } from '../../src/config/config.js';
import type { SessionEvent, SessionStatus } from '../../src/loop/session.js';

class FakeRunner implements SessionRunner {
  approved: string[] = [];
  denied: string[] = [];
  private cbs: Array<(ev: SessionEvent) => void> = [];
  onEvent(cb: (ev: SessionEvent) => void) { this.cbs.push(cb); return () => { this.cbs = this.cbs.filter(c => c !== cb); }; }
  async startDemo() { return 's-demo'; }
  async approve(id: string) { this.approved.push(id); }
  async deny(id: string) { this.denied.push(id); }
  async list(): Promise<SessionInfo[]> { return [{ sessionId: 's-demo', status: 'done', task: 'demo', startedAt: new Date().toISOString() }]; }
  emit(ev: SessionEvent) { this.cbs.forEach(c => c(ev)); }
}

function cfg(dir: string): HarnessConfig {
  const c = defaultConfig();
  return { ...c, workspace: dir, memory: { filePath: join(dir, 'mem.jsonl') } };
}

describe('ConsoleServer', () => {
  let server: ConsoleServer;
  let runner: FakeRunner;
  let secrets: SecretStore;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-console-'));
    secrets = new SecretStore(join(dir, 'secrets.json'));
    await secrets.init('pw');
    await secrets.set('openai', 'sk-abc12345');
    runner = new FakeRunner();
    server = new ConsoleServer({ port: 0, host: '127.0.0.1', runner, secrets, config: cfg(dir) });
    await server.start();
  });

  afterEach(async () => { await server.stop(); });

  const get = (p: string) => fetch(`${server.url}${p}`);
  const post = (p: string, body?: unknown) => fetch(`${server.url}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  it('GET /api/config is secret-free', async () => {
    const res = await get('/api/config');
    expect(res.ok).toBe(true);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('sk-');
    expect(body).toContain('workspace');
  });
  it('GET /api/sessions lists sessions', async () => {
    const res = await get('/api/sessions');
    const list = await res.json();
    expect(list[0].sessionId).toBe('s-demo');
  });
  it('POST /api/demo/run starts a demo session', async () => {
    const res = await post('/api/demo/run');
    expect((await res.json()).sessionId).toBe('s-demo');
  });
  it('POST /api/approvals/:id/approve delegates to runner', async () => {
    await post('/api/approvals/req-1/approve');
    expect(runner.approved).toContain('req-1');
  });
  it('POST /api/approvals/:id/deny delegates to runner', async () => {
    await post('/api/approvals/req-1/deny');
    expect(runner.denied).toContain('req-1');
  });
  it('GET /api/secrets returns masked values only', async () => {
    const res = await get('/api/secrets');
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('sk-abc12345');
    expect(body).toContain('2345');
  });
  it('DELETE /api/secrets/:name unsets', async () => {
    await fetch(`${server.url}/api/secrets/openai`, { method: 'DELETE' });
    const res = await get('/api/secrets');
    const list = await res.json();
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/console/server.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/console/server.ts`：

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { HarnessConfig } from '../config/config.js';
import type { SecretStore } from '../secret/store.js';
import type { SessionEvent, SessionStatus } from '../loop/session.js';

export interface SessionInfo { sessionId: string; status: SessionStatus; task: string; startedAt: string; }
export interface SessionRunner {
  startDemo(): Promise<string>;
  approve(id: string): Promise<void>;
  deny(id: string): Promise<void>;
  list(): Promise<SessionInfo[]>;
  onEvent(cb: (ev: SessionEvent) => void): () => void;
}
export interface ConsoleServerOptions {
  port: number; host: string;
  runner: SessionRunner; secrets: SecretStore; config: HarnessConfig;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function json(res: ServerResponse, status: number, obj: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export class ConsoleServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private unsubscribe: () => void = () => {};
  private _url = '';

  constructor(private readonly opts: ConsoleServerOptions) {}

  get url() { return this._url; }

  async start(): Promise<void> {
    const { runner, secrets, config } = this.opts;
    const staticPath = fileURLToPath(new URL('./static/index.html', import.meta.url));
    this.server = createServer((req, res) => {
      void this.route(req, res, staticPath, runner, secrets, config);
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
    });
    this.unsubscribe = runner.onEvent(ev => {
      for (const c of this.clients) { if (c.readyState === c.OPEN) c.send(JSON.stringify(ev)); }
    });
    await new Promise<void>(resolve => {
      this.server!.listen(this.opts.port, this.opts.host, () => {
        const addr = this.server!.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        this._url = `http://${this.opts.host}:${port}`;
        resolve();
      });
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse, staticPath: string,
    runner: SessionRunner, secrets: SecretStore, config: HarnessConfig): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const p = url.pathname;
    if (req.method === 'GET' && p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(staticPath)); return; }
    if (req.method === 'GET' && p === '/api/config') {
      return json(res, 200, { workspace: config.workspace, sandbox: config.sandbox, budget: config.budget, console: config.console, policy: config.policy });
    }
    if (req.method === 'GET' && p === '/api/sessions') return json(res, 200, await runner.list());
    if (req.method === 'POST' && p === '/api/demo/run') return json(res, 200, { sessionId: await runner.startDemo() });
    const approvalMatch = p.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
    if (req.method === 'POST' && approvalMatch) {
      const [, id, act] = approvalMatch;
      if (act === 'approve') await runner.approve(id); else await runner.deny(id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/secrets') return json(res, 200, await secrets.list());
    if (req.method === 'POST' && p === '/api/secrets') {
      const body = JSON.parse(await readBody(req)) as { name?: string; value?: string };
      if (!body.name || typeof body.value !== 'string') return json(res, 400, { error: 'name and value required' });
      await secrets.set(body.name, body.value);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && p.startsWith('/api/secrets/')) {
      const name = decodeURIComponent(p.slice('/api/secrets/'.length));
      await secrets.unset(name);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  }

  async stop(): Promise<void> {
    this.unsubscribe();
    this.clients.forEach(c => c.close());
    if (this.wss) await new Promise<void>(r => this.wss!.close(() => r()));
    if (this.server) await new Promise<void>(r => this.server!.close(() => r()));
    this.server = null;
    this.wss = null;
  }
}
```

`src/console/static/index.html`（简洁但完整的内联单页）：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>AI4SE Harness Console</title></head>
<body>
  <h1>AI4SE Harness Console</h1>
  <section>
    <h2>配置（只读）</h2>
    <pre id="cfg"></pre>
  </section>
  <section>
    <h2>Demo</h2>
    <button id="runDemo">运行 Demo 会话</button>
    <ul id="sessions"></ul>
  </section>
  <section>
    <h2>凭据管理</h2>
    <form id="secretForm">
      <input id="secretName" placeholder="name" required>
      <input id="secretValue" type="password" placeholder="value" required>
      <button type="submit">保存</button>
    </form>
    <ul id="secrets"></ul>
  </section>
  <section>
    <h2>会话日志（实时）</h2>
    <pre id="log" style="max-height:40vh;overflow:auto"></pre>
  </section>
  <script>
    const $ = id => document.getElementById(id);
    async function j(path, init) { const r = await fetch(path, init); return r.status === 204 ? null : r.json(); }
    async function refresh() {
      $('cfg').textContent = JSON.stringify(await j('/api/config'), null, 2);
      const sess = await j('/api/sessions');
      $('sessions').innerHTML = sess.map(s => `<li>${s.sessionId} — ${s.status} — ${s.task}</li>`).join('');
      const sec = await j('/api/secrets');
      $('secrets').innerHTML = sec.map(s => `<li>${s.name}: ${s.masked}</li>`).join('');
    }
    $('runDemo').onclick = async () => { await j('/api/demo/run', { method: 'POST' }); await refresh(); };
    $('secretForm').onsubmit = async (e) => {
      e.preventDefault();
      await j('/api/secrets', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: $('secretName').value, value: $('secretValue').value }) });
      $('secretValue').value = ''; await refresh();
    };
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = e => { $('log').textContent += e.data + '\n'; };
    refresh();
  </script>
</body>
</html>
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/console/server.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/console tests/console
git commit -m "feat(T10): web console (http+ws) with config/sessions/secrets APIs"
```

---

## Task 11: Demo 模块与机制演示（§A.6）

**Files:**
- Create: `src/demo/project/sum.js`, `src/demo/project/sum.test.js`, `src/demo/project/policy.json`, `src/demo/project/package.json`, `src/demo/demo.ts`, `tests/demo/demo.test.ts`

**Interfaces:**
- Consumes: T4 MockLLM；T5 tools；T6a-d；T7；T8；T9 `HarnessSession`/`SessionDeps`/`SessionEvent`；T10 `SessionRunner`/`SessionInfo`。
- Produces:

```ts
export const DEMO_SCRIPT: string[];
export function demoPolicy(): PolicyRule[];
export function demoProjectRoot(): string; // src/demo/project 的绝对路径
export function demoTools(): ToolRegistry;
export function buildDemoSession(opts?: { approvals?: 'auto' | 'deny' }): { deps: SessionDeps; events: SessionEvent[]; hitl: HITLStateMachine };
export async function runDemo(opts?: { approvals?: 'auto' | 'deny' }): Promise<SessionReport>; // 打印三行为证据后返回 report
export class DemoSessionRunner implements SessionRunner {
  constructor(base?: string);
  startDemo(): Promise<string>;
  approve(id: string): Promise<void>;   // 通过内部 hitl.approve 处理
  deny(id: string): Promise<void>;
  list(): Promise<SessionInfo[]>;
  onEvent(cb: (ev: SessionEvent) => void): () => void;
}
```

- demo 工程（纯 JS，零依赖，`node --test` 可跑；**必须含 `package.json` `{"type":"module"}`，否则 `.js` 里的 `import` 会被当 CJS 解析而失败**）：
  - `package.json`：`{ "name": "ai4se-demo-project", "type": "module" }`
  - `sum.js`：`export function sum(a, b) { return a - b; }`（故意错误）
  - `sum.test.js`：`import { sum } from './sum.js';` + `node:test` 断言 `sum(1,2)===3`
  - `policy.json`：两条规则——`BLOCK regex "rm -rf"`；`ASK exact "write_file"`
- `DEMO_SCRIPT`（5 步）：
  1. `{"tool":"run_command","args":{"command":"rm -rf /tmp/ai4se-demo"}}` → BLOCK
  2. `{"tool":"run_tests","args":{}}` → TEST_FAILURE
  3. `{"tool":"write_file","args":{"path":"sum.js","content":"export function sum(a,b){return a+b;}"}}` → ASK → 批准后执行
  4. `{"tool":"run_tests","args":{}}` → PASS
  5. `{"tool":"done","args":{"summary":"sum fixed"}}` → done
- `runDemo` 输出三行为证据：① 拦截 `rm -rf`；② TEST_FAILURE 反馈后下一步为 write_file；③ HITL PENDING→APPROVED→执行。
- `DemoSessionRunner`：维护会话列表（`sessionId`、`status`、`task`、`startedAt`）与事件订阅；`startDemo` 调 `runDemo`（approvals='auto'）并广播事件；`approve/deny` 转发到当前会话的 `hitl`。

- [ ] **Step 1: 写失败测试 `tests/demo/demo.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/demo/demo.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/demo/project/sum.js`：

```js
export function sum(a, b) {
  return a - b;
}
```

`src/demo/project/sum.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { sum } from './sum.js';

test('sum(1, 2) === 3', () => {
  assert.strictEqual(sum(1, 2), 3);
});
```

`src/demo/project/package.json`：

```json
{ "name": "ai4se-demo-project", "type": "module" }
```

`src/demo/project/policy.json`：

```json
[
  { "id": "no-rm-rf", "tier": "BLOCK", "match": { "type": "regex", "pattern": "rm -rf" }, "reason": "destructive command blocked" },
  { "id": "ask-write", "tier": "ASK", "match": { "type": "exact", "pattern": "write_file" }, "reason": "file modification needs approval" }
]
```

`src/demo/demo.ts`：

```ts
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
```

注意：demo 会话的 `resolveApproval` 设为 `auto`（自动批准），因此通过控制台手动 `approve/deny` 只影响"会话内已存在且仍 PENDING 的请求"；手动审批的完整路径由 `run --task` 的非 demo 模式提供（T12 的 `cliApprover`）。这是有意的设计取舍，请保留。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/demo/demo.test.ts`
Expected: PASS（demo 内含真实 `node --test` 执行，需 Node ≥ 20）。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/demo tests/demo
git commit -m "feat(T11): demo project + mechanism demo (guardrail/feedback/HITL)"
```

---

## Task 12: CLI 入口（commander）

**Files:**
- Create: `src/governance/store.ts`, `src/session/recorder.ts`, `src/cli/input.ts`, `src/cli.ts`, `tests/cli/cli.test.ts`

**Interfaces:**
- Consumes: T1–T11 全部模块。
- Produces:

```ts
// governance/store.ts
export class InMemoryRequestStore implements RequestStore { /* 与 tests/helpers/inmem.ts 相同实现 */ }

// session/recorder.ts
export class SessionRecorder {
  constructor(dir: string);
  write(report: SessionReport): Promise<string>; // 写 sessions/<id>.jsonl（每行一个 StepRecord），返回路径
}

// cli/input.ts
export function readHidden(prompt: string): Promise<string>; // 掩码输入（_writeToOutput 覆写为 `*`）
export function readLine(prompt: string): Promise<string>;

// cli.ts
export interface CliDeps {
  storePath?: string;              // 默认 ~/.ai4se-harness/secrets.json（os.homedir()）
  passwordReader?: (prompt: string) => Promise<string>;
  configPath?: string;
  sessionsDir?: string;
  gitignorePath?: string;          // 默认 './.gitignore'（init 使用）
}
export function createProgram(deps?: CliDeps): Command;
export async function main(argv = process.argv): Promise<void>;
```

- 子命令（详见 SPEC M1）：
  - `init`：写 `harness.config.json`（`defaultConfig()` 且 `workspace:'.'`）+ 追加 `.gitignore`（`secrets.json`/`sessions/`/`.env`，已存在则跳过）。
  - `run --task <t> [--config <p>] [--demo]`：`--demo` 走 `runDemo()`；否则按 config 组装依赖并 `HarnessSession.run()`；结束后用 `SessionRecorder` 落盘并打印摘要；status 为 done 退出 0，stalled/aborted 退出 1。
  - `console [--port <n>] [--host <s>]`：启动 `ConsoleServer`（`DemoSessionRunner` + 真实 `SecretStore`）；打印 URL；监听 SIGINT 停止。
  - `secrets <init|set|get|unset|list> [name] [--store <p>] [--reveal]`：见 SPEC M1/M9 语义；非 TTY 下 `--reveal` 被拒。
  - `policy validate <file>`：JSON 解析 + `GuardrailEngine.validate`，非法退出非零。
- 非交互 `run`（无 --task）→ 报错退出 1。

- [ ] **Step 1: 写失败测试 `tests/cli/cli.test.ts`**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli.js';

const run = (program: ReturnType<typeof createProgram>, args: string[]) =>
  program.parseAsync(['node', 'cli.js', ...args], { from: 'user' });

describe('CLI', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ai4se-cli-')); });

  it('init writes harness.config.json and .gitignore', async () => {
    await run(createProgram({ storePath: join(dir, 's.json'), configPath: join(dir, 'harness.config.json'), gitignorePath: join(dir, '.gitignore') }), ['init']);
    expect(existsSync(join(dir, 'harness.config.json'))).toBe(true);
    expect(readFileSync(join(dir, 'harness.config.json'), 'utf8')).toContain('workspace');
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
  });

  it('policy validate accepts a valid policy file', async () => {
    const p = join(dir, 'policy.json');
    writeFileSync(p, JSON.stringify([{ id: 'r', tier: 'BLOCK', match: { type: 'regex', pattern: 'rm -rf' }, reason: 'x' }]));
    await run(createProgram({}), ['policy', 'validate', p]); // 不抛错即通过
  });

  it('policy validate rejects an invalid policy file', async () => {
    const p = join(dir, 'policy.json');
    writeFileSync(p, JSON.stringify([{ id: 'r', tier: 'BLOCK', match: { type: 'regex', pattern: '(' }, reason: 'x' }]));
    const program = createProgram({});
    program.exitOverride();
    let code = 0;
    program.exitOverride((c) => { code = c; throw new Error(`exit ${c}`); });
    await expect(run(program, ['policy', 'validate', p])).rejects.toThrow(/exit [^0]/);
    expect(code).not.toBe(0);
  });

  it('run --demo completes and writes a session report', async () => {
    const sessionsDir = join(dir, 'sessions');
    await run(createProgram({ storePath: join(dir, 's.json'), sessionsDir }), ['run', '--demo']);
    const files = existsSync(sessionsDir) ? readdirSync(sessionsDir) : [];
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.endsWith('.jsonl'))).toBe(true);
  }, 30000);

  it('run without --task errors', async () => {
    const program = createProgram({});
    program.exitOverride();
    await expect(run(program, ['run'])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`src/governance/store.ts`：

```ts
import type { ActionRequest, RequestStore } from './hitl.js';

export class InMemoryRequestStore implements RequestStore {
  private m = new Map<string, ActionRequest>();
  async save(r: ActionRequest) { this.m.set(r.id, r); }
  async update(r: ActionRequest) { this.m.set(r.id, r); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async all() { return [...this.m.values()]; }
}
```

`src/session/recorder.ts`：

```ts
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionReport } from '../loop/session.js';

export class SessionRecorder {
  constructor(private readonly dir: string) {}
  async write(report: SessionReport): Promise<string> {
    mkdirSync(this.dir, { recursive: true });
    const p = join(this.dir, `${report.sessionId}.jsonl`);
    for (const step of report.steps) appendFileSync(p, JSON.stringify(step) + '\n', 'utf8');
    appendFileSync(p, JSON.stringify({ sessionId: report.sessionId, status: report.status, reason: report.reason, steps: report.steps.length }) + '\n', 'utf8');
    return p;
  }
}
```

`src/cli/input.ts`：

```ts
import { createInterface } from 'node:readline';

export function readHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s: string) {
    if (s === '\r\n' || s === '\n') { rl.output.write(s); return; }
    rl.output.write('*'.repeat(s.length));
  };
  return new Promise(resolve => rl.question('', (answer) => { rl.close(); resolve(answer); }));
}

export function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}
```

`src/cli.ts`（要点，完整实现见注释）：

```ts
import { Command, CommanderError } from 'commander';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { defaultConfig, loadConfig, HarnessConfig } from './config/config.js';
import { GuardrailEngine } from './governance/guardrail.js';
import { ScopeFence } from './governance/scope.js';
import { ProcessExecutor } from './governance/executor.js';
import { HITLStateMachine } from './governance/hitl.js';
import { InMemoryRequestStore } from './governance/store.js';
import { FeedbackClassifier } from './feedback/classifier.js';
import { MemoryStore } from './memory/store.js';
import { ToolRegistry } from './tools/registry.js';
import { readFileTool, writeFileTool } from './tools/file.js';
import { runCommandTool, runTestsTool, runTypecheckTool, runLintTool, doneTool } from './tools/run.js';
import { MockLLM } from './llm/mock.js';
import { OpenAICompatClient } from './llm/openai.js';
import { HarnessSession, SessionDeps } from './loop/session.js';
import { ConsoleServer } from './console/server.js';
import { SecretStore } from './secret/store.js';
import { DemoSessionRunner, runDemo } from './demo/demo.js';
import { SessionRecorder } from './session/recorder.js';
import { readHidden, readLine } from './cli/input.js';
import type { ActionRequest } from './governance/hitl.js';

export interface CliDeps {
  storePath?: string;
  passwordReader?: (prompt: string) => Promise<string>;
  configPath?: string;
  sessionsDir?: string;
  gitignorePath?: string; // 默认 './.gitignore'（init 使用）
}

function defaultStorePath() { return join(homedir(), '.ai4se-harness', 'secrets.json'); }

function buildTools(cfg: HarnessConfig): ToolRegistry {
  const r = new ToolRegistry();
  const all = { read_file: readFileTool, write_file: writeFileTool, run_command: runCommandTool,
    run_tests: runTestsTool, run_typecheck: runTypecheckTool, run_lint: runLintTool, done: doneTool };
  for (const name of cfg.tools.enabled) if (all[name as keyof typeof all]) r.register(all[name as keyof typeof all]);
  return r;
}

export function createProgram(deps: CliDeps = {}): Command {
  const storePath = deps.storePath ?? defaultStorePath();
  const readPw = deps.passwordReader ?? readHidden;
  const program = new Command();
  program.name('ai4se-harness').description('A self-hosted coding agent harness').version('0.1.0');

  program.command('init')
    .description('write harness.config.json template and .gitignore')
    .action(async () => {
      const configPath = deps.configPath ?? 'harness.config.json';
      if (existsSync(configPath)) throw new Error(`${configPath} already exists`);
      writeFileSync(configPath, JSON.stringify({ ...defaultConfig(), workspace: '.' }, null, 2) + '\n');
      const gitignore = deps.gitignorePath ?? '.gitignore';
      const add = ['sessions/', '.env', '**/secrets.json'];
      const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
      const toAdd = add.filter(l => !existing.includes(l));
      if (toAdd.length) appendFileSync(gitignore, '\n' + toAdd.join('\n') + '\n');
    });

  program.command('run')
    .option('--task <t>', 'task description')
    .option('--config <p>', 'path to harness.config.json')
    .option('--demo', 'run the deterministic demo')
    .action(async (opts) => {
      const recorder = new SessionRecorder(deps.sessionsDir ?? 'sessions');
      if (opts.demo) {
        const report = await runDemo();
        const path = await recorder.write(report);
        console.log(`[run] status=${report.status} steps=${report.steps.length} reason=${report.reason} log=${path}`);
        process.exitCode = report.status === 'done' ? 0 : 1;
        return;
      }
      if (!opts.task) throw new Error('--task is required unless --demo is used');
      const configPath = deps.configPath ?? opts.config ?? 'harness.config.json';
      const config = loadConfig(configPath);
      const scope = new ScopeFence([config.workspace]);
      const executor = new ProcessExecutor();
      const hitl = new HITLStateMachine(new InMemoryRequestStore());
      let llm;
      if (config.llm.provider === 'openai-compat') {
        const store = new SecretStore(storePath);
        await store.unlock(await readPw('master password: '));
        const key = await store.get('openai');
        if (!key) throw new Error('no key stored under "openai"; run: ai4se-harness secrets set openai');
        llm = new OpenAICompatClient({ baseURL: config.llm.baseURL ?? 'https://api.openai.com/v1', apiKey: key, model: config.llm.model ?? 'gpt-4o-mini' });
      } else {
        llm = new MockLLM([]);
      }
      const cliApprover = async (req: ActionRequest): Promise<ActionRequest> => {
        if (!process.stdin.isTTY) return { ...req, status: 'DENIED' as const, decidedAt: Date.now(), decidedBy: 'cli-non-tty' };
        const answer = (await readLine(`approve ${req.action.tool} ${JSON.stringify(req.action.args)}? [y/N] `)).toLowerCase();
        return answer === 'y' ? hitl.approve(req.id, 'cli') : hitl.deny(req.id, 'cli');
      };
      const depsForSession: SessionDeps = {
        task: opts.task, config, llm, tools: buildTools(config),
        guardrail: new GuardrailEngine(config.policy), scope, executor, hitl,
        classifier: new FeedbackClassifier(), memory: new MemoryStore(config.memory.filePath),
        resolveApproval: cliApprover,
      };
      const report = await new HarnessSession(depsForSession).run();
      const recorder = new SessionRecorder(deps.sessionsDir ?? 'sessions');
      const path = await recorder.write(report);
      console.log(`[run] status=${report.status} reason=${report.reason} log=${path}`);
      process.exitCode = report.status === 'done' ? 0 : 1;
    });

  program.command('console')
    .option('--port <n>', 'port', (v) => parseInt(v, 10), 8117)
    .option('--host <s>', 'host', '127.0.0.1')
    .action(async (opts) => {
      const secrets = new SecretStore(storePath);
      if (!(await secrets.isInitialized())) throw new Error('secrets not initialized; run: ai4se-harness secrets init');
      const cfgPath = deps.configPath ?? 'harness.config.json';
      const config = existsSync(cfgPath) ? loadConfig(cfgPath) : { ...defaultConfig(), workspace: '.' };
      const server = new ConsoleServer({ port: opts.port, host: opts.host, runner: new DemoSessionRunner(), secrets, config });
      await server.start();
      console.log(`console at ${server.url}`);
      await new Promise<void>(() => { /* SIGINT */ });
    });

  const secrets = program.command('secrets').description('manage API keys');
  secrets.command('init')
    .action(async () => {
      const store = new SecretStore(storePath);
      if (await store.isInitialized()) throw new Error('already initialized');
      const pw = await readPw('create master password: ');
      const confirm = await readPw('confirm master password: ');
      if (pw !== confirm) throw new Error('passwords do not match');
      await store.init(pw);
      console.log(`secret store created at ${storePath}`);
    });
  secrets.command('set <name>')
    .action(async (name: string) => {
      const store = new SecretStore(storePath);
      await store.unlock(await readPw('master password: '));
      const value = await readPw(`value for ${name}: `);
      await store.set(name, value);
      console.log(`saved ${name}`);
    });
  secrets.command('get <name>')
    .option('--reveal', 'reveal plaintext on a TTY')
    .action(async (name: string, opts) => {
      const store = new SecretStore(storePath);
      await store.unlock(await readPw('master password: '));
      if (opts.reveal) {
        if (!process.stdin.isTTY) throw new Error('--reveal requires a TTY');
        const v = await store.get(name);
        if (v) { console.log(v); process.exitCode = 0; } else { console.error('not found'); process.exitCode = 1; }
      } else {
        const [entry] = (await store.list()).filter(e => e.name === name);
        console.log(entry ? `${entry.name}: ${entry.masked}` : 'not found');
      }
    });
  secrets.command('unset <name>')
    .action(async (name: string) => {
      const store = new SecretStore(storePath);
      await store.unlock(await readPw('master password: '));
      await store.unset(name);
      console.log(`removed ${name}`);
    });
  secrets.command('list')
    .action(async () => {
      const store = new SecretStore(storePath);
      await store.unlock(await readPw('master password: '));
      for (const e of await store.list()) console.log(`${e.name}: ${e.masked}`);
    });

  program.command('policy validate <file>')
    .description('validate a policy JSON file')
    .action((file: string) => {
      const rules = JSON.parse(readFileSync(file, 'utf8'));
      GuardrailEngine.validate(rules);
      console.log('policy OK');
    });

  program.exitOverride((err: CommanderError) => {
    if (err.exitCode !== 0) console.error(`error: ${err.message}`);
    process.exitCode = err.exitCode;
  });
  return program;
}

export async function main(argv = process.argv): Promise<void> {
  try {
    await createProgram().parseAsync(argv);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
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
  void main();
}

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 + 更新 PLAN.md + AGENT_LOG.md**

```bash
git add src/cli.ts src/cli src/session src/governance/store.ts tests/cli
git commit -m "feat(T12): CLI with init/run/console/secrets/policy validate"
```

---

## Task 13: 打包 / README / CI 收尾

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.gitlab-ci.yml`, `README.md`, `REFLECTION.md`（1500–2500 字反思，见 §4 通用要求）
- Modify: `package.json`（如需补 `engines`）、`.github/workflows/ci.yml`（如加构建/镜像步骤）、`AGENT_LOG.md`、`SPEC_PROCESS.md`（如冷启动后有修订需同步）

**Interfaces:**
- Consumes: 全部前置 task。
- Produces: 交付物齐备——`Dockerfile`、`README.md`、`.gitlab-ci.yml` 模板、最终 `npm test` 全绿、最终 CI pass、五交付物（SPEC/PLAN/SPEC_PROCESS/AGENT_LOG/REFLECTION）齐。

- [ ] **Step 1: 写 `Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8117
CMD ["node", "dist/cli.js", "console", "--port", "8117", "--host", "0.0.0.0"]
```

`.dockerignore`：

```
node_modules
dist
sessions
.env
**/secrets.json
.git
```

- [ ] **Step 2: 写 `.gitlab-ci.yml` 模板（不作为主 CI，供 NJU GitLab 镜像备选）**

```yaml
stages: [test]
unit-test:
  stage: test
  image: node:20
  script:
    - npm ci
    - npm test
```

- [ ] **Step 3: 写 `README.md`**（必须包含：项目简介、安装、运行、分发命令、目录结构、安全边界说明、已知限制）

要点（照实写，不夸大）：
- 简介：Agent = LLM + Harness 的编码 agent harness，主贡献为治理/护栏/沙箱。
- 安装：`npm i -g ai4se-harness` 或 `npx ai4se-harness`；要求 Node ≥ 20。
- 运行：`ai4se-harness init` → `ai4se-harness secrets init` → `ai4se-harness secrets set openai` → `ai4se-harness run --task "..."`；无 key 演示：`ai4se-harness run --demo`。
- 控制台：`ai4se-harness console` → `http://127.0.0.1:8117`。
- 分发：`docker build -t ai4se-harness .` + `docker run -p 8117:8117 ai4se-harness`（mock demo）；真实 LLM 时挂载 secrets 文件或 `AI4SE_OPENAI_KEY` env（注明权衡）。
- key 安全配置：主密码加密文件 `~/.ai4se-harness/secrets.json`（AES-256-GCM + scrypt）；`.env` 备选源及其明文风险；进程环境会被 `envFilter` 过滤。
- 安全边界：沙箱 = 代码级围栏（命令守卫 + 范围围栏 + 进程执行器 + HITL），**非 OS 级隔离**；Docker 模式为可选强隔离。
- 已知限制：Node ≥ 20；Windows/Linux 路径行为差异；`run_lint` 依赖项目配置 `npm run lint`；mock demo 为 deterministic scripted，不反映真实 LLM 行为。
- 目录结构表（src/ 各模块一句话职责）。

- [ ] **Step 4: 收尾验证（全部通过才可宣称完成）**

Run:
1. `npm test` → 全绿
2. `npm run build` → tsc 无错
3. `npm run demo` → 输出三行为证据（① BLOCK rm -rf ② TEST_FAILURE→write_file ③ HITL APPROVED）
4. `git grep -n -E "(sk-[A-Za-z0-9]{10,}|AI4SE_.*=.+)"` → 无真实 key
5. 最后一次 `git push` 触发 GitHub Actions → `unit-test` job 为 **pass**
6. `git log --oneline` 复核各 task 均有 commit（附 PLAN.md 中记录的 hash）
7. 五交付物齐：`SPEC.md`、`PLAN.md`（全勾选+hash）、`SPEC_PROCESS.md`（含 §4.5 冷启动记录）、`AGENT_LOG.md`（逐 task 记录）、`REFLECTION.md`（1500–2500 字反思，按 §4 通用要求内容）；无缺项

- [ ] **Step 5: 提交**

```bash
git add Dockerfile .dockerignore .gitlab-ci.yml README.md .github
git commit -m "docs(T13): distribution (Docker), README, gitlab template, final checks"
```

- [ ] **Step 6: 更新 PLAN.md（全部勾选 + hash）与 AGENT_LOG.md，提交。**
