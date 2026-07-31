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
