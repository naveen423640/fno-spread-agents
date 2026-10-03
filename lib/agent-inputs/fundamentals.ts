import type { AnalystInput } from '../agents/orchestrator';
import { unavailable, type GatherArgs } from './common';

// No verified Indian source for results calendar, quarterly figures or promoter pledge exists yet (spec A2 open item).
export function gatherFundamentals(args: GatherArgs): AnalystInput {
  return unavailable('fundamentals', args.asOf, 'no verified source yet');
}
