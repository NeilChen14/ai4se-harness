import { mkdirSync, appendFileSync } from 'node:fs';
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
