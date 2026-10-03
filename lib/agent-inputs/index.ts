import type { AnalystInput } from '../agents/orchestrator';
import { loadOptionChain, loadQuote } from '../fyers-analyst-tools';
import { fetchDailyCandles } from '../regime/fyers-daily';
import type { GatherArgs, GatherDeps } from './common';
import { gatherFundamentals } from './fundamentals';
import { gatherNews } from './news';
import { gatherOptionsOi } from './options-oi';
import { gatherTechnical } from './technical';

export type { GatherArgs, GatherDeps } from './common';

const defaults = (): GatherDeps => ({ fetchDaily: fetchDailyCandles, loadQuote, loadOptionChain, fetchImpl: fetch });

// Server-side only. The credentials are used inside the gatherers and never placed in a returned value.
export async function gatherInputs(args: GatherArgs, deps: GatherDeps = defaults()): Promise<AnalystInput[]> {
  const [technical, options, news] = await Promise.all([gatherTechnical(args, deps), gatherOptionsOi(args, deps), gatherNews(args, deps)]);
  return [technical, options, news, gatherFundamentals(args)];
}
