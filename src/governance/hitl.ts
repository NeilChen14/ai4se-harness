import { randomUUID } from 'node:crypto';
import type { AgentAction } from '../types.js';

export type HITLStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'TIMED_OUT';
export interface ActionRequest {
  id: string; sessionId: string; action: AgentAction;
  status: HITLStatus; createdAt: number; decidedAt?: number; decidedBy?: string; ttlMs: number;
}
export interface RequestStore {
  save(r: ActionRequest): Promise<void>;
  update(r: ActionRequest): Promise<void>;
  get(id: string): Promise<ActionRequest | null>;
  all(): Promise<ActionRequest[]>; // sweepExpired / list 用
}
export class HITLError extends Error {
  constructor(m: string) { super(m); this.name = 'HITLError'; }
}

export class HITLStateMachine {
  constructor(private readonly store: RequestStore, private readonly ttlMs = 120_000) {}

  async request(action: AgentAction, sessionId: string): Promise<ActionRequest> {
    const req: ActionRequest = {
      id: randomUUID(), sessionId, action, status: 'PENDING',
      createdAt: Date.now(), ttlMs: this.ttlMs,
    };
    await this.store.save(req);
    return req;
  }

  async get(id: string): Promise<ActionRequest | null> { return this.store.get(id); }

  private async transition(id: string, to: 'APPROVED' | 'DENIED' | 'TIMED_OUT', by: string): Promise<ActionRequest> {
    const req = await this.store.get(id);
    if (!req) throw new HITLError(`unknown request: ${id}`);
    if (req.status === to) return req; // 幂等
    if (req.status !== 'PENDING') throw new HITLError(`request ${id} is already ${req.status}`);
    const next: ActionRequest = { ...req, status: to, decidedAt: Date.now(), decidedBy: by };
    await this.store.update(next);
    return next;
  }

  approve(id: string, by: string) { return this.transition(id, 'APPROVED', by); }
  deny(id: string, by: string) { return this.transition(id, 'DENIED', by); }
  timeout(id: string) { return this.transition(id, 'TIMED_OUT', 'system'); }

  async sweepExpired(now = Date.now()): Promise<ActionRequest[]> {
    const expired: ActionRequest[] = [];
    for (const req of await this.store.all()) {
      if (req.status === 'PENDING' && now - req.createdAt > req.ttlMs) {
        expired.push(await this.timeout(req.id));
      }
    }
    return expired;
  }
}
