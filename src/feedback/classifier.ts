import type { Feedback, FeedbackCategory, ToolResult } from '../types.js';

function timedOut(result: ToolResult): boolean {
  return result.exitCode === null && /timed out/i.test(result.error ?? '');
}

export class FeedbackClassifier {
  classify(toolName: string, result: ToolResult): Feedback {
    let category: FeedbackCategory;
    if (timedOut(result)) category = 'TIMEOUT';
    else if (result.ok && result.exitCode === 0) category = 'PASS';
    else if (toolName === 'run_tests') category = 'TEST_FAILURE';
    else if (toolName === 'run_typecheck') category = 'COMPILE_ERROR';
    else if (toolName === 'run_lint') category = 'LINT_ERROR';
    else category = 'OTHER';
    const detail = result.error ?? result.output.trim().split('\n').slice(0, 10).join('\n');
    return { category, summary: `${category}: ${detail.slice(0, 500)}` };
  }
}
