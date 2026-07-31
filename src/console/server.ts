import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { HarnessConfig } from '../config/config.js';
import type { SecretStore } from '../secret/store.js';
import type { SessionEvent, SessionStatus } from '../loop/session.js';

export interface SessionInfo { sessionId: string; status: SessionStatus; task: string; startedAt: string; }
export interface SessionRunner {
  startDemo(): Promise<string>;
  approve(id: string): Promise<void>;
  deny(id: string): Promise<void>;
  list(): Promise<SessionInfo[]>;
  onEvent(cb: (ev: SessionEvent) => void): () => void;
}
export interface ConsoleServerOptions {
  port: number; host: string;
  runner: SessionRunner; secrets: SecretStore; config: HarnessConfig;
  readonly?: boolean; // 只读模式（云端 mock demo）：凭据 API 只读、不要求凭据文件
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function json(res: ServerResponse, status: number, obj: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export class ConsoleServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private unsubscribe: () => void = () => {};
  private _url = '';

  constructor(private readonly opts: ConsoleServerOptions) {}

  get url() { return this._url; }

  async start(): Promise<void> {
    const { runner, secrets, config } = this.opts;
    const staticPath = fileURLToPath(new URL('./static/index.html', import.meta.url));
    this.server = createServer((req, res) => {
      void this.route(req, res, staticPath, runner, secrets, config);
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
    });
    this.unsubscribe = runner.onEvent(ev => {
      for (const c of this.clients) { if (c.readyState === c.OPEN) c.send(JSON.stringify(ev)); }
    });
    await new Promise<void>(resolve => {
      this.server!.listen(this.opts.port, this.opts.host, () => {
        const addr = this.server!.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        this._url = `http://${this.opts.host}:${port}`;
        resolve();
      });
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse, staticPath: string,
    runner: SessionRunner, secrets: SecretStore, config: HarnessConfig): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const p = url.pathname;
    const readonly = this.opts.readonly === true;
    if (req.method === 'GET' && p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(staticPath)); return; }
    if (req.method === 'GET' && p === '/api/config') {
      return json(res, 200, { workspace: config.workspace, sandbox: config.sandbox, budget: config.budget, console: config.console, policy: config.policy, readonly });
    }
    if (req.method === 'GET' && p === '/api/sessions') return json(res, 200, await runner.list());
    if (req.method === 'POST' && p === '/api/demo/run') return json(res, 200, { sessionId: await runner.startDemo() });
    const approvalMatch = p.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
    if (req.method === 'POST' && approvalMatch) {
      const [, id, act] = approvalMatch;
      if (act === 'approve') await runner.approve(id); else await runner.deny(id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/secrets') {
      if (readonly) return json(res, 200, []);
      return json(res, 200, await secrets.list());
    }
    if (req.method === 'POST' && p === '/api/secrets') {
      if (readonly) return json(res, 403, { error: 'read-only mode' });
      const body = JSON.parse(await readBody(req)) as { name?: string; value?: string };
      if (!body.name || typeof body.value !== 'string') return json(res, 400, { error: 'name and value required' });
      await secrets.set(body.name, body.value);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && p.startsWith('/api/secrets/')) {
      if (readonly) return json(res, 403, { error: 'read-only mode' });
      const name = decodeURIComponent(p.slice('/api/secrets/'.length));
      await secrets.unset(name);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  }

  async stop(): Promise<void> {
    this.unsubscribe();
    this.clients.forEach(c => c.close());
    if (this.wss) await new Promise<void>(r => this.wss!.close(() => r()));
    if (this.server) await new Promise<void>(r => this.server!.close(() => r()));
    this.server = null;
    this.wss = null;
  }
}
