import type { AgentAction, Decision, Tier } from '../types.js';

export type RuleMatchType = 'exact' | 'regex' | 'prefix' | 'path';
export interface PolicyRule {
  id: string; tier: Tier;
  match: { type: RuleMatchType; pattern: string }; reason: string;
}
export class PolicyError extends Error {
  constructor(m: string) { super(m); this.name = 'PolicyError'; }
}

function signatureOf(a: AgentAction): string {
  return a.tool === 'run_command' ? String(a.args.command ?? '') : a.tool;
}
function matches(rule: PolicyRule, sig: string, pathArg: string | undefined): boolean {
  switch (rule.match.type) {
    case 'exact': return sig === rule.match.pattern;
    case 'prefix': return sig.startsWith(rule.match.pattern);
    case 'regex': {
      try { return new RegExp(rule.match.pattern).test(sig); } catch { return false; }
    }
    case 'path': return pathArg !== undefined && new RegExp(rule.match.pattern).test(pathArg);
  }
}

export class GuardrailEngine {
  constructor(private readonly rules: PolicyRule[]) { GuardrailEngine.validate(this.rules); }

  decide(action: AgentAction): Decision {
    const sig = signatureOf(action);
    const pathArg = typeof action.args.path === 'string' ? action.args.path : undefined;
    const tierOrder: Record<Tier, number> = { BLOCK: 3, ASK: 2, ALLOW: 1 };
    let best: PolicyRule | undefined;
    for (const r of this.rules) {
      if (!matches(r, sig, pathArg)) continue;
      if (!best || tierOrder[r.tier] > tierOrder[best.tier]) best = r;
    }
    return best
      ? { tier: best.tier, ruleId: best.id, reason: best.reason }
      : { tier: 'ALLOW', reason: 'no rule matched' };
  }

  static validate(rules: PolicyRule[]): void {
    for (const r of rules) {
      if (!r.id) throw new PolicyError('rule id is required');
      if (!['ALLOW', 'ASK', 'BLOCK'].includes(r.tier)) throw new PolicyError(`invalid tier on rule ${r.id}`);
      if (!['exact', 'regex', 'prefix', 'path'].includes(r.match.type)) throw new PolicyError(`invalid match type on rule ${r.id}`);
      if (r.match.type === 'regex') {
        try { new RegExp(r.match.pattern); } catch { throw new PolicyError(`invalid regex on rule ${r.id}`); }
      }
    }
  }
}
