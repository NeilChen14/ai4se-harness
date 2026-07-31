export type Tier = 'ALLOW' | 'ASK' | 'BLOCK';
export type SessionStatus = 'running' | 'done' | 'stalled' | 'aborted';
export type FeedbackCategory =
  | 'PASS' | 'COMPILE_ERROR' | 'TEST_FAILURE' | 'LINT_ERROR'
  | 'TIMEOUT' | 'FORMAT_ERROR' | 'OTHER';

export interface AgentAction { tool: string; args: Record<string, unknown>; }
export interface Decision { tier: Tier; ruleId?: string; reason: string; }
export interface ToolResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  error?: string;
}
export interface Feedback { category: FeedbackCategory; summary: string; }
export interface StepRecord {
  index: number;
  action: AgentAction;
  decision: Decision;
  execution?: ToolResult;
  feedback?: Feedback;
  llmCallId: string;
  ts: string;
}
