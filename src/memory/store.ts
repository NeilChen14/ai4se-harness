import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type MemoryKind = 'task-decision' | 'project-convention' | 'approval-history' | 'error';
export interface MemoryEntry { id: string; kind: MemoryKind; content: string; tags: string[]; ts: number; }

export class MemoryStore {
  constructor(private readonly filePath: string) {}

  private ensureFile() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) appendFileSync(this.filePath, '');
  }

  async add(kind: MemoryKind, content: string, tags: string[] = []): Promise<MemoryEntry> {
    this.ensureFile();
    const entry: MemoryEntry = { id: randomUUID(), kind, content, tags, ts: Date.now() };
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  }

  async all(): Promise<MemoryEntry[]> {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as MemoryEntry);
  }

  async query(opts: { kind?: MemoryKind; keywords?: string[]; limit?: number } = {}): Promise<MemoryEntry[]> {
    let rows = (await this.all()).map((r, i) => ({ r, i }));
    if (opts.kind) rows = rows.filter(x => x.r.kind === opts.kind);
    if (opts.keywords && opts.keywords.length) {
      rows = rows.filter(x => opts.keywords!.some(kw => x.r.content.toLowerCase().includes(kw.toLowerCase()) || x.r.tags.some(t => t.toLowerCase().includes(kw.toLowerCase()))));
    }
    rows.sort((x, y) => (y.r.ts - x.r.ts) || (y.i - x.i));
    const out = rows.map(x => x.r);
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  async summary(limit = 10): Promise<string> {
    const rows = await this.query({ limit });
    return rows.map(r => `[${r.kind}] ${r.content}`).join('\n');
  }
}
