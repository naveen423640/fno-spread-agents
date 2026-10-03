import { PROMPT_SET_ID } from '../agents/prompts';
import { runAgentTeam } from '../agents/orchestrator';
import type { AgentStore } from '../agents/store';
import type { gatherInputs } from '../agent-inputs';
import type { Credentials } from '../agent-inputs/common';
import type { LlmClient } from '../llm/types';
import { istDate, lastCompletedSession } from '../market-session';

export type StartDeps = {
  store: AgentStore;
  llm: LlmClient;
  gather: typeof gatherInputs;
  schedule: (work: Promise<unknown>) => void;
  now: () => Date;
  newId: () => string;
  universe: ReadonlySet<string>;
};

export type StartResult = { runId: string } | { error: string; status: 400 };

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const redact = (text: string, credentials: Credentials | null) => (credentials ? text.split(credentials.accessToken).join('[redacted]') : text);

// Creates the run, schedules the work and returns at once. The work is a background job, never part of the request.
export async function startAgentRun(deps: StartDeps, body: unknown, credentials: Credentials | null): Promise<StartResult> {
  if (!body || typeof body !== 'object') return { error: 'Send a JSON body with a symbol.', status: 400 };
  const { symbol, asOf: suppliedAsOf, calculatedLots } = body as { symbol?: unknown; asOf?: unknown; calculatedLots?: unknown };
  if (typeof symbol !== 'string' || !deps.universe.has(symbol)) return { error: 'Choose a stock from the F&O universe.', status: 400 };

  const now = deps.now();
  let asOf = lastCompletedSession(now);
  if (suppliedAsOf !== undefined) {
    if (typeof suppliedAsOf !== 'string' || !validDate(suppliedAsOf)) return { error: 'asOf must be a valid YYYY-MM-DD date.', status: 400 };
    if (suppliedAsOf > istDate(now)) return { error: 'asOf cannot be in the future.', status: 400 };
    asOf = suppliedAsOf;
  }
  if (calculatedLots !== undefined && (typeof calculatedLots !== 'number' || !Number.isInteger(calculatedLots) || calculatedLots < 1)) {
    return { error: 'calculatedLots must be a whole number of at least 1.', status: 400 };
  }
  const lots = typeof calculatedLots === 'number' ? calculatedLots : null;

  const runId = deps.newId();
  await deps.store.createRun({ id: runId, symbol, asOf, tradingDate: asOf, candidate: { calculatedLots: lots }, promptSet: PROMPT_SET_ID });

  deps.schedule((async () => {
    try {
      const inputs = await deps.gather({ symbol, asOf, now, credentials });
      await runAgentTeam({ llm: deps.llm, store: deps.store }, { runId, symbol, asOf, tradingDate: asOf, calculatedLots: lots, inputs });
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), credentials);
      try {
        await deps.store.saveStep({ runId, role: 'run', status: 'failed', error: message });
        await deps.store.setRunStatus(runId, 'failed', new Date().toISOString());
      } catch {
        // Nothing more can be recorded; the run stays "running" and the caller sees no verdict.
      }
    }
  })());

  return { runId };
}
