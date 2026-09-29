import type { PayoffLeg } from './strategy-payoff';

export type ExecutionAssumptions = {
  brokeragePerOrder: number;
  slippagePerUnit: number;
  clearingPercent: number;
  additionalRoundTrip: number;
};
export const defaultExecution: ExecutionAssumptions = {
  brokeragePerOrder: 20, slippagePerUnit: 0.05, clearingPercent: 0.009, additionalRoundTrip: 0,
};
export const COST_MODEL_VERSION = 'nse-options-2026-09-v1';
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function istToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
export function normalizeExecution(value?: Partial<ExecutionAssumptions> | null): ExecutionAssumptions {
  if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) throw new Error('Invalid execution assumptions.');
  const result = { ...defaultExecution, ...value };
  for (const [key, maximum] of Object.entries({ brokeragePerOrder: 1000, slippagePerUnit: 1000, clearingPercent: 1, additionalRoundTrip: 100000 })) {
    const n = result[key as keyof ExecutionAssumptions];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > maximum) throw new Error(`Invalid ${key}: choose a non-negative value no greater than ${maximum}.`);
  }
  return result;
}
export function optionSaleSttRate(date: string) { return date >= '2026-04-01' ? 0.0015 : date >= '2024-10-01' ? 0.001 : 0.000625; }
export type CostBreakdown = { brokerage: number; exchange: number; ipft: number; clearing: number; sebi: number; stt: number; stamp: number; gst: number; slippage: number; additional: number; total: number };
const emptyCosts = (): CostBreakdown => ({ brokerage: 0, exchange: 0, ipft: 0, clearing: 0, sebi: 0, stt: 0, stamp: 0, gst: 0, slippage: 0, additional: 0, total: 0 });

// Square-off estimates only. Physical delivery, funding, exercise and RMS charges are not modelled.
export function estimateRoundTripCosts(legs: PayoffLeg[], lotSize: number, exitPrices: number[], entryDate: string, exitDate: string, assumptions: ExecutionAssumptions): CostBreakdown {
  if (!validDate(entryDate) || !validDate(exitDate) || exitPrices.length !== legs.length || exitPrices.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('Invalid dated marks for cost estimation.');
  const config = normalizeExecution(assumptions);
  const costs = emptyCosts();
  legs.forEach((leg, index) => {
    const quantity = leg.quantity * lotSize;
    for (const exit of [false, true]) {
      const date = exit ? exitDate : entryDate;
      const side = exit ? -leg.side : leg.side;
      const mark = exit ? exitPrices[index] : leg.entryPrice;
      const fill = Math.max(0, mark + side * config.slippagePerUnit);
      const turnover = fill * quantity;
      costs.slippage += Math.abs(fill - mark) * quantity;
      costs.brokerage += config.brokeragePerOrder; // one order per leg, irrespective of lots
      costs.exchange += turnover * (date >= '2026-03-01' ? 0.000355299 : date >= '2024-10-01' ? 0.0003503 : 0.000495);
      costs.ipft += turnover * (date >= '2026-03-01' ? 0.000000001 : 0.000005);
      costs.clearing += turnover * config.clearingPercent / 100;
      costs.sebi += turnover * 0.000001;
      if (side === -1) costs.stt += turnover * optionSaleSttRate(date);
      if (side === 1) costs.stamp += turnover * 0.00003;
    }
  });
  costs.gst = 0.18 * (costs.brokerage + costs.exchange + costs.ipft + costs.clearing + costs.sebi);
  costs.additional = config.additionalRoundTrip;
  costs.total = Object.entries(costs).filter(([key]) => key !== 'total').reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(Object.entries(costs).map(([key, value]) => [key, Math.round(value * 100) / 100])) as CostBreakdown;
}
