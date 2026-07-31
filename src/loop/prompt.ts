import type { HarnessConfig } from '../config/config.js';

export function buildSystemPrompt(config: HarnessConfig): string {
  const tools = config.tools.enabled.join(', ');
  return [
    'You are a coding agent. You may use the following tools:',
    tools,
    'Respond with ONLY a single JSON object of the form {"tool":"<name>","args":{...}}.',
    'run_tests/run_typecheck/run_lint execute the project validators. Write code, run validators,',
    'read the feedback, and iterate until validators pass, then call the "done" tool with a summary.',
  ].join('\n');
}
