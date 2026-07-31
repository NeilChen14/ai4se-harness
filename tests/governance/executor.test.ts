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
