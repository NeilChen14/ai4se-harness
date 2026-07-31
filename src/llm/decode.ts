import type { AgentAction } from '../types.js';

export class FormatError extends Error {
  constructor(m: string) { super(m); this.name = 'FormatError'; }
}

export function decodeAction(content: string): AgentAction {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new FormatError('action is not valid JSON'); }
  const a = parsed as Partial<AgentAction>;
  if (typeof a?.tool !== 'string' || typeof a.args !== 'object' || a.args === null) {
    throw new FormatError('action must have string tool and object args');
  }
  return { tool: a.tool, args: a.args as Record<string, unknown> };
}
