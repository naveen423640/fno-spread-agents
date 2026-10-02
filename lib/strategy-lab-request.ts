type LegInput = { optionType: 'CE' | 'PE'; strike: number; side: 1 | -1; quantity: number };
type LegLike = LegInput & Record<string, unknown>;

export type StrategyLabRequest = {
  action: 'build' | 'sync';
  ticker: string;
  startDate: string;
  strategy: string;
  legs?: LegInput[];
};

// A sync can run before any legs are loaded (the server falls back to the strategy's default legs), so it
// omits `legs` in that case. A build always needs the user's legs and returns null without them.
export function strategyLabRequest(action: 'build' | 'sync', input: { ticker: string; startDate: string; strategy: string; legs: readonly LegLike[] }): StrategyLabRequest | null {
  const { ticker, startDate, strategy } = input;
  if (!input.legs.length) return action === 'sync' ? { action, ticker, startDate, strategy } : null;
  return { action, ticker, startDate, strategy, legs: input.legs.map(({ optionType, strike, side, quantity }) => ({ optionType, strike, side, quantity })) };
}
