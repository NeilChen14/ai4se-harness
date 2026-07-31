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
