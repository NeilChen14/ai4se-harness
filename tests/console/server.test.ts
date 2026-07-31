import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleServer, SessionRunner, SessionInfo } from '../../src/console/server.js';
import { SecretStore } from '../../src/secret/store.js';
import { HarnessConfig, defaultConfig } from '../../src/config/config.js';
import type { SessionEvent, SessionStatus } from '../../src/loop/session.js';

class FakeRunner implements SessionRunner {
  approved: string[] = [];
  denied: string[] = [];
  private cbs: Array<(ev: SessionEvent) => void> = [];
  onEvent(cb: (ev: SessionEvent) => void) { this.cbs.push(cb); return () => { this.cbs = this.cbs.filter(c => c !== cb); }; }
  async startDemo() { return 's-demo'; }
  async approve(id: string) { this.approved.push(id); }
  async deny(id: string) { this.denied.push(id); }
  async list(): Promise<SessionInfo[]> { return [{ sessionId: 's-demo', status: 'done', task: 'demo', startedAt: new Date().toISOString() }]; }
  emit(ev: SessionEvent) { this.cbs.forEach(c => c(ev)); }
}

function cfg(dir: string): HarnessConfig {
  const c = defaultConfig();
  return { ...c, workspace: dir, memory: { filePath: join(dir, 'mem.jsonl') } };
}

describe('ConsoleServer', () => {
  let server: ConsoleServer;
  let runner: FakeRunner;
  let secrets: SecretStore;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-console-'));
    secrets = new SecretStore(join(dir, 'secrets.json'));
    await secrets.init('pw');
    await secrets.set('openai', 'sk-abc12345');
    runner = new FakeRunner();
    server = new ConsoleServer({ port: 0, host: '127.0.0.1', runner, secrets, config: cfg(dir) });
    await server.start();
  });

  afterEach(async () => { await server.stop(); });

  const get = (p: string) => fetch(`${server.url}${p}`);
  const post = (p: string, body?: unknown) => fetch(`${server.url}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  it('GET /api/config is secret-free', async () => {
    const res = await get('/api/config');
    expect(res.ok).toBe(true);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('sk-');
    expect(body).toContain('workspace');
  });
  it('GET /api/sessions lists sessions', async () => {
    const res = await get('/api/sessions');
    const list = await res.json();
    expect(list[0].sessionId).toBe('s-demo');
  });
  it('POST /api/demo/run starts a demo session', async () => {
    const res = await post('/api/demo/run');
    expect((await res.json()).sessionId).toBe('s-demo');
  });
  it('POST /api/approvals/:id/approve delegates to runner', async () => {
    await post('/api/approvals/req-1/approve');
    expect(runner.approved).toContain('req-1');
  });
  it('POST /api/approvals/:id/deny delegates to runner', async () => {
    await post('/api/approvals/req-1/deny');
    expect(runner.denied).toContain('req-1');
  });
  it('GET /api/secrets returns masked values only', async () => {
    const res = await get('/api/secrets');
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('sk-abc12345');
    expect(body).toContain('2345');
  });
  it('DELETE /api/secrets/:name unsets', async () => {
    await fetch(`${server.url}/api/secrets/openai`, { method: 'DELETE' });
    const res = await get('/api/secrets');
    const list = await res.json();
    expect(list).toHaveLength(0);
  });
});
