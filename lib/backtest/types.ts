export type QualitySeverity = 'PASS' | 'WARNING' | 'FAIL';

export type ResearchConfiguration = {
  completedCycles: 6;
  stocksPerCycle: 50;
  entryTimeIst: '09:20';
  minimumRewardRisk: 2;
  stopLoss: 'NONE';
  profitExitPercent: 80;
  forcedExitTimeIst: '15:15';
  slippagePerLeg: number;
  roundTripCosts: number;
};

export type FoRow = {
  tradingDate: string;
  instrumentType: string;
  ticker: string;
  expiryDate: string;
  strike: number;
  optionType: 'CE' | 'PE' | '';
  instrumentName: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  underlyingPrice: number;
  tradedVolume: number;
  tradedValue: number;
  lotSize: number;
  openInterest: number;
  changeInOpenInterest: number;
};

export type CmRow = {
  ticker: string;
  series: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  tradedVolume: number;
  tradedValue: number;
};

export type ContractSnapshot = {
  strike: number;
  optionType: 'CE' | 'PE';
  fyersSymbol: string;
};

export type CycleSnapshot = {
  expiryDate: string;
  firstEligibleTradingDay: string;
  entryTimestamp: string;
  previousTradingDay: string;
  t1TradingDay: string;
  rankingRows: FoRow[];
};

export type FyersHistory = {
  ok: boolean;
  candles: number[][];
  code?: number;
  message?: string;
};
