import type { ActionRequest, RequestStore } from '../../src/governance/hitl.js';

export class InMemoryStore implements RequestStore {
  private m = new Map<string, ActionRequest>();
  async save(r: ActionRequest) { this.m.set(r.id, r); }
  async update(r: ActionRequest) { this.m.set(r.id, r); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async all() { return [...this.m.values()]; }
}
