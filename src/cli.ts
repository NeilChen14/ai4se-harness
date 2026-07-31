#!/usr/bin/env node
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
import type { LLMClient } from './llm/client.js';
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
      let llm: LLMClient;
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
      const path = await recorder.write(report);
      console.log(`[run] status=${report.status} reason=${report.reason} log=${path}`);
      process.exitCode = report.status === 'done' ? 0 : 1;
    });

  program.command('console')
    .option('--port <n>', 'port', (v) => parseInt(v, 10), 8117)
    .option('--host <s>', 'host', '127.0.0.1')
    .action(async (opts) => {
      const readonly = process.env.AI4SE_READONLY === '1';
      const secrets = new SecretStore(storePath);
      if (!readonly && !(await secrets.isInitialized())) throw new Error('secrets not initialized; run: ai4se-harness secrets init');
      const cfgPath = deps.configPath ?? 'harness.config.json';
      const config = existsSync(cfgPath) ? loadConfig(cfgPath) : { ...defaultConfig(), workspace: '.' };
      const server = new ConsoleServer({ port: opts.port, host: opts.host, runner: new DemoSessionRunner(), secrets, config, readonly });
      await server.start();
      console.log(`console at ${server.url}${readonly ? ' (read-only mock demo, no credentials exposed)' : ''}`);
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

  program.command('policy')
    .command('validate <file>')
    .description('validate a policy JSON file')
    .action((file: string) => {
      try {
        const rules = JSON.parse(readFileSync(file, 'utf8'));
        GuardrailEngine.validate(rules);
        console.log('policy OK');
      } catch (e) {
        program.error((e as Error).message);
      }
    });

  program.exitOverride((err: CommanderError) => {
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
