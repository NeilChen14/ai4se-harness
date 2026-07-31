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
