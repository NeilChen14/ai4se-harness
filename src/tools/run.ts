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
