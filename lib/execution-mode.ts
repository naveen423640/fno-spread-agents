export type ExecutionSettings = { executionMode: 'paper'; liveExecutionEnabled: false };

// Fail closed: only the exact strings "paper" and "false" are accepted; unset means the safe defaults.
export function readExecutionSettings(env: Record<string, string | undefined> = process.env): ExecutionSettings {
  const mode = env.EXECUTION_MODE ?? 'paper';
  const live = env.LIVE_EXECUTION_ENABLED ?? 'false';
  if (mode !== 'paper') throw new Error(`EXECUTION_MODE must be "paper" (got "${mode}"). Live execution is disabled in this system.`);
  if (live !== 'false') throw new Error('LIVE_EXECUTION_ENABLED must be "false". Live execution is disabled in this system.');
  return { executionMode: 'paper', liveExecutionEnabled: false };
}

export function assertPaperOnly(): void {
  readExecutionSettings();
}
