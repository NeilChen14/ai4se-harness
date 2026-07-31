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
