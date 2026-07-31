import type { AgentAction, ToolResult } from '../types.js';
import type { ScopeFence } from '../governance/scope.js';
import type { ProcessExecutor } from '../governance/executor.js';

export interface ToolContext { scope: ScopeFence; executor: ProcessExecutor; workdir: string; }
export interface Tool {
  name: string;
  schema: Record<string, 'string' | 'number' | 'boolean'>;
  invoke(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
export class ToolError extends Error {
  constructor(m: string) { super(m); this.name = 'ToolError'; }
}
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(tool: Tool) { this.tools.set(tool.name, tool); }
  has(name: string) { return this.tools.has(name); }
  async dispatch(action: AgentAction, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(action.tool);
    if (!tool) throw new ToolError(`unknown tool: ${action.tool}`);
    for (const [k, type] of Object.entries(tool.schema)) {
      const v = action.args[k];
      if (v === undefined) return { ok: false, output: '', exitCode: null, error: `missing arg: ${k}` };
      if (typeof v !== type) return { ok: false, output: '', exitCode: null, error: `arg ${k} must be ${type}` };
    }
    try { return await tool.invoke(action.args, ctx); }
    catch (e) { return { ok: false, output: '', exitCode: null, error: (e as Error).message }; }
  }
}
