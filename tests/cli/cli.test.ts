import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli.js';

const run = (program: ReturnType<typeof createProgram>, args: string[]) =>
  program.parseAsync(args, { from: 'user' });

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
