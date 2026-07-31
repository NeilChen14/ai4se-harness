import { describe, expect, it } from 'vitest';
import { HITLStateMachine, HITLError, ActionRequest } from '../../src/governance/hitl.js';
import { InMemoryStore } from '../helpers/inmem.js';

const action = { tool: 'run_command', args: { command: 'git push' } };
const mk = (ttl = 1000) => new HITLStateMachine(new InMemoryStore(), ttl);

describe('HITLStateMachine', () => {
  it('creates a PENDING request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    expect(req.status).toBe('PENDING');
    expect(req.action).toEqual(action);
  });
  it('approve transitions PENDING to APPROVED', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    const out = await m.approve(req.id, 'console');
    expect(out.status).toBe('APPROVED');
    expect(out.decidedBy).toBe('console');
  });
  it('deny transitions PENDING to DENIED', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    expect((await m.deny(req.id, 'cli')).status).toBe('DENIED');
  });
  it('approve is idempotent on an approved request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    await m.approve(req.id, 'cli');
    const again = await m.approve(req.id, 'cli');
    expect(again.status).toBe('APPROVED');
  });
  it('approve throws on a denied request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    await m.deny(req.id, 'cli');
    await expect(m.approve(req.id, 'cli')).rejects.toThrow(HITLError);
  });
  it('sweepExpired marks overdue requests as TIMED_OUT', async () => {
    const m = mk(50);
    const req = await m.request(action, 's1');
    await m.sweepExpired(Date.now() + 1000);
    const cur = await m.get(req.id);
    expect(cur?.status).toBe('TIMED_OUT');
  });
  it('timeout transitions PENDING to TIMED_OUT and is idempotent', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    expect((await m.timeout(req.id)).status).toBe('TIMED_OUT');
    expect((await m.timeout(req.id)).status).toBe('TIMED_OUT');
  });
  it('timeout throws on an approved request', async () => {
    const m = mk();
    const req = await m.request(action, 's1');
    await m.approve(req.id, 'cli');
    await expect(m.timeout(req.id)).rejects.toThrow(HITLError);
  });
});
