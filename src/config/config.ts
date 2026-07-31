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
