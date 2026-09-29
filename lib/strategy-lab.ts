import { calendarDates, clearNseReportCaches, fetchCmReport, fetchFoReport, releaseFoReport } from './backtest/nse-data';
import type { FoRow } from './backtest/types';
import { loadStoredStrategyLabReport, saveStrategyLabReport } from './strategy-lab-store';
import { calculateRiskMetrics } from './strategy-payoff';

export type StrategyKey = 'long-call' | 'long-put' | 'bull-call' | 'bear-put' | 'long-straddle' | 'long-strangle' | 'bull-put' | 'bear-call' | 'butterfly' | 'iron-condor';
type OptionType = 'CE' | 'PE';
type LegTemplate = { optionType: OptionType; offset: number; side: 1 | -1; quantity: number };

export type StrategyLabPoint = { underlying: number; expiryPnl: number; selectedDayPnl: number };
export type StrategyLabOiPoint = { strike: number; callOi: number; putOi: number; callOiChange: number; putOiChange: number };
export type StrategyLabLeg = { symbol: string; optionType: OptionType; strike: number; side: 1 | -1; quantity: number; entryPrice: number };
export type StrategyLegInput = Pick<StrategyLabLeg, 'optionType' | 'strike' | 'side' | 'quantity'>;
export type StrategyLabSetup = {
  ticker: string;
  requestedStartDate: string;
  entryDate: string;
  expiryDate: string;
  strategy: StrategyKey;
  strategyLabel: string;
  lotSize: number;
  entryUnderlying: number;
  availableStrikes: number[];
  contracts: Array<{ symbol: string; optionType: OptionType; strike: number; price: number; openInterest: number }>;
  defaultLegs: StrategyLabLeg[];
};
export type StrategyLabSync = {
  ticker: string;
  expiryDate: string;
  sessionsStored: number;
  optionRowsStored: number;
  latestStoredDate: string;
  syncedAt: string;
  source: string;
};
export type StrategyLabDay = {
  date: string;
  underlyingClose: number;
  actualPnl: number;
  modelPnlAtSpot: number;
  curve: StrategyLabPoint[];
  openInterest: StrategyLabOiPoint[];
  legMarks: Array<{ symbol: string; close: number; openInterest: number; changeInOpenInterest: number }>;
};
export type StrategyLabResult = {
  ticker: string;
  requestedStartDate: string;
  entryDate: string;
  expiryDate: string;
  strategy: StrategyKey;
  strategyLabel: string;
  lotSize: number;
  entryUnderlying: number;
  entryNetPremium: number;
  capitalAtRiskLabel: string;
  maxProfit: number | null;
  maxLoss: number | null;
  rewardRisk: number | null;
  breakevens: number[];
  estimatedCapital: number;
  legs: StrategyLabLeg[];
  days: StrategyLabDay[];
  skippedSessions: number;
  source: string;
  methodology: string;
};

const strategyDefinitions: Record<StrategyKey, { label: string; legs: LegTemplate[]; risk: string }> = {
  'long-call': { label: 'Buy Call', risk: 'Premium paid', legs: [{ optionType: 'CE', offset: 0, side: 1, quantity: 1 }] },
  'long-put': { label: 'Buy Put', risk: 'Premium paid', legs: [{ optionType: 'PE', offset: 0, side: 1, quantity: 1 }] },
  'bull-call': { label: 'Bull Call Spread', risk: 'Net debit', legs: [{ optionType: 'CE', offset: 0, side: 1, quantity: 1 }, { optionType: 'CE', offset: 1, side: -1, quantity: 1 }] },
  'bear-put': { label: 'Bear Put Spread', risk: 'Net debit', legs: [{ optionType: 'PE', offset: 0, side: 1, quantity: 1 }, { optionType: 'PE', offset: -1, side: -1, quantity: 1 }] },
  'long-straddle': { label: 'Long Straddle', risk: 'Premium paid', legs: [{ optionType: 'CE', offset: 0, side: 1, quantity: 1 }, { optionType: 'PE', offset: 0, side: 1, quantity: 1 }] },
  'long-strangle': { label: 'Long Strangle', risk: 'Premium paid', legs: [{ optionType: 'PE', offset: -1, side: 1, quantity: 1 }, { optionType: 'CE', offset: 1, side: 1, quantity: 1 }] },
  'bull-put': { label: 'Bull Put Spread', risk: 'Defined-risk credit', legs: [{ optionType: 'PE', offset: -1, side: 1, quantity: 1 }, { optionType: 'PE', offset: 0, side: -1, quantity: 1 }] },
  'bear-call': { label: 'Bear Call Spread', risk: 'Defined-risk credit', legs: [{ optionType: 'CE', offset: 0, side: -1, quantity: 1 }, { optionType: 'CE', offset: 1, side: 1, quantity: 1 }] },
  butterfly: { label: 'Call Butterfly', risk: 'Net debit', legs: [{ optionType: 'CE', offset: -1, side: 1, quantity: 1 }, { optionType: 'CE', offset: 0, side: -1, quantity: 2 }, { optionType: 'CE', offset: 1, side: 1, quantity: 1 }] },
  'iron-condor': { label: 'Iron Condor', risk: 'Defined-risk credit', legs: [{ optionType: 'PE', offset: -2, side: 1, quantity: 1 }, { optionType: 'PE', offset: -1, side: -1, quantity: 1 }, { optionType: 'CE', offset: 1, side: -1, quantity: 1 }, { optionType: 'CE', offset: 2, side: 1, quantity: 1 }] },
};

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function optionValue(spot: number, strike: number, years: number, volatility: number, optionType: OptionType) {
  if (years <= 0) return optionType === 'CE' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const rate = 0.065;
  const sigmaRootT = Math.max(volatility, 0.0001) * Math.sqrt(years);
  const d1 = (Math.log(Math.max(spot, 0.01) / strike) + (rate + volatility * volatility / 2) * years) / sigmaRootT;
  const d2 = d1 - sigmaRootT;
  return optionType === 'CE'
    ? spot * normalCdf(d1) - strike * Math.exp(-rate * years) * normalCdf(d2)
    : strike * Math.exp(-rate * years) * normalCdf(-d2) - spot * normalCdf(-d1);
}

function impliedVolatility(price: number, spot: number, strike: number, years: number, optionType: OptionType) {
  if (years <= 0) return 0.0001;
  let low = 0.0001;
  let high = 5;
  for (let index = 0; index < 70; index += 1) {
    const middle = (low + high) / 2;
    if (optionValue(spot, strike, years, middle, optionType) > price) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}

function yearsToExpiry(date: string, expiryDate: string) {
  const from = new Date(`${date}T15:30:00+05:30`).getTime();
  const to = new Date(`${expiryDate}T15:30:00+05:30`).getTime();
  return Math.max(0, (to - from) / (365.25 * 24 * 60 * 60 * 1000));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function firstReportOnOrAfter(startDate: string) {
  const probeEnd = new Date(`${startDate}T00:00:00Z`);
  probeEnd.setUTCDate(probeEnd.getUTCDate() + 7);
  for (const date of calendarDates(startDate, probeEnd.toISOString().slice(0, 10))) {
    const rows = await fetchFoReport(date);
    if (rows?.length) return { date, rows };
  }
  return null;
}

async function loadReports(dates: string[], ticker: string, expiryDate: string, forceNse = false, strictStore = false) {
  const results: Array<{ date: string; rows: FoRow[] } | null> = [];
  for (let index = 0; index < dates.length; index += 4) {
    const batch = dates.slice(index, index + 4);
    const loaded = await Promise.all(batch.map(async (date) => {
      if (!forceNse) {
        try {
          const stored = await loadStoredStrategyLabReport(ticker, expiryDate, date);
          if (stored?.length) return { date, rows: stored };
        } catch (error) {
          if (strictStore) throw error;
        }
      }
      const reportRows = await fetchFoReport(date);
      const rows = reportRows?.filter((row) => row.instrumentType === 'STO' && row.ticker === ticker && row.expiryDate === expiryDate && row.optionType) ?? [];
      if (!rows.length) return null;
      try {
        await saveStrategyLabReport(ticker, expiryDate, date, rows);
      } catch (error) {
        if (strictStore) throw error;
      }
      return { date, rows };
    }));
    results.push(...loaded);
  }
  return results.filter((result): result is { date: string; rows: FoRow[] } => Boolean(result));
}

function contractKey(optionType: OptionType, strike: number) {
  return `${optionType}:${strike}`;
}

export async function loadStrategyLabSetup(ticker: string, requestedStartDate: string, strategyKey: StrategyKey): Promise<StrategyLabSetup> {
  const definition = strategyDefinitions[strategyKey];
  if (!definition) throw new Error('Choose a supported ready-made strategy.');
  const entryReport = await firstReportOnOrAfter(requestedStartDate);
  if (!entryReport) throw new Error('No NSE F&O report was found on or within seven days after the selected start date.');
  const entryRows = entryReport.rows.filter((row) => row.instrumentType === 'STO' && row.ticker === ticker && row.optionType && row.expiryDate >= entryReport.date);
  if (!entryRows.length) throw new Error(`${ticker} has no stock-option contracts in the NSE archive for this start date.`);
  const expiryDate = [...new Set(entryRows.map((row) => row.expiryDate))].sort()[0];
  const expiryRows = entryRows.filter((row) => row.expiryDate === expiryDate && row.close > 0);
  const entryUnderlying = expiryRows.find((row) => row.underlyingPrice > 0)?.underlyingPrice ?? 0;
  if (entryUnderlying <= 0) throw new Error('The NSE report does not contain a usable underlying price for the entry date.');
  const strikes = [...new Set(expiryRows.map((row) => row.strike).filter((strike) => strike > 0))].sort((a, b) => a - b);
  const atmIndex = strikes.reduce((nearest, strike, index) => Math.abs(strike - entryUnderlying) < Math.abs(strikes[nearest] - entryUnderlying) ? index : nearest, 0);
  const rowsByContract = new Map(expiryRows.map((row) => [contractKey(row.optionType as OptionType, row.strike), row]));
  const defaultLegs: StrategyLabLeg[] = definition.legs.map((template) => {
    const strike = strikes[atmIndex + template.offset];
    const row = strike === undefined ? undefined : rowsByContract.get(contractKey(template.optionType, strike));
    if (!row) throw new Error(`${definition.label} cannot be built: ${template.optionType} strike offset ${template.offset} is unavailable on ${entryReport.date}.`);
    return { symbol: row.instrumentName, optionType: template.optionType, strike, side: template.side, quantity: template.quantity, entryPrice: row.close };
  });
  const lotSize = expiryRows.find((row) => row.lotSize > 0)?.lotSize ?? 0;
  if (!lotSize) throw new Error('The NSE report does not contain a usable lot size.');
  return {
    ticker,
    requestedStartDate,
    entryDate: entryReport.date,
    expiryDate,
    strategy: strategyKey,
    strategyLabel: definition.label,
    lotSize,
    entryUnderlying: round(entryUnderlying),
    availableStrikes: strikes,
    contracts: expiryRows.filter((row) => row.optionType === 'CE' || row.optionType === 'PE').map((row) => ({ symbol: row.instrumentName, optionType: row.optionType as OptionType, strike: row.strike, price: row.close, openInterest: row.openInterest })),
    defaultLegs,
  };
}

function validateStrikeOrder(strategyKey: StrategyKey, legs: StrategyLabLeg[]) {
  const strikes = legs.map((leg) => leg.strike);
  const valid = strategyKey === 'bull-call' ? strikes[0] < strikes[1]
    : strategyKey === 'bear-put' ? strikes[0] > strikes[1]
    : strategyKey === 'bull-put' ? strikes[0] < strikes[1]
    : strategyKey === 'bear-call' ? strikes[0] < strikes[1]
    : strategyKey === 'long-strangle' ? strikes[0] < strikes[1]
    : strategyKey === 'butterfly' ? strikes[0] < strikes[1] && strikes[1] < strikes[2]
    : strategyKey === 'iron-condor' ? strikes[0] < strikes[1] && strikes[1] < strikes[2] && strikes[2] < strikes[3]
    : true;
  if (!valid) throw new Error('The selected strikes are not in the valid order for this strategy. Adjust them before building.');
}

export async function buildStrategyLabResult(ticker: string, requestedStartDate: string, strategyKey: StrategyKey, requestedLegs?: StrategyLegInput[]): Promise<StrategyLabResult> {
  const definition = strategyDefinitions[strategyKey];
  if (!definition) throw new Error('Choose a supported ready-made strategy.');
  const setup = await loadStrategyLabSetup(ticker, requestedStartDate, strategyKey);
  const contractMap = new Map(setup.contracts.map((contract) => [contractKey(contract.optionType, contract.strike), contract]));
  let legs = setup.defaultLegs;
  if (requestedLegs) {
    if (requestedLegs.length !== definition.legs.length) throw new Error('The submitted strategy legs do not match this ready-made strategy.');
    legs = requestedLegs.map((requested, index) => {
      const template = definition.legs[index];
      if (requested.optionType !== template.optionType || requested.side !== template.side) throw new Error('Only strikes and lot quantities can be changed for a ready-made strategy.');
      if (!Number.isInteger(requested.quantity) || requested.quantity < 1 || requested.quantity > 20) throw new Error('Each strategy leg must use between 1 and 20 lots.');
      const contract = contractMap.get(contractKey(requested.optionType, requested.strike));
      if (!contract) throw new Error(`${requested.strike} ${requested.optionType} is unavailable for the selected entry date and expiry.`);
      return { symbol: contract.symbol, optionType: requested.optionType, strike: requested.strike, side: requested.side, quantity: requested.quantity, entryPrice: contract.price };
    });
  }
  validateStrikeOrder(strategyKey, legs);
  const { entryDate, expiryDate, entryUnderlying, lotSize, availableStrikes: strikes } = setup;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const availableThrough = expiryDate < today ? expiryDate : today;
  const dates = calendarDates(entryDate, availableThrough);
  const reports = await loadReports(dates, ticker, expiryDate);
  const entryNetPremium = legs.reduce((sum, leg) => sum + leg.side * leg.quantity * leg.entryPrice, 0);
  const metrics = calculateRiskMetrics(legs, lotSize);
  const minReference = Math.min(entryUnderlying, ...legs.map((leg) => leg.strike));
  const maxReference = Math.max(entryUnderlying, ...legs.map((leg) => leg.strike));
  const xMin = minReference * 0.82;
  const xMax = maxReference * 1.18;
  const xValues = Array.from({ length: 81 }, (_, index) => xMin + ((xMax - xMin) * index) / 80);
  let skippedSessions = 0;
  const days: StrategyLabDay[] = [];

  for (const report of reports) {
    const contractRows = report.rows.filter((row) => row.instrumentType === 'STO' && row.ticker === ticker && row.expiryDate === expiryDate && row.optionType);
    const byContract = new Map(contractRows.map((row) => [contractKey(row.optionType as OptionType, row.strike), row]));
    const legRows = legs.map((leg) => byContract.get(contractKey(leg.optionType, leg.strike)));
    if (legRows.some((row) => !row || row.close <= 0)) {
      skippedSessions += 1;
      releaseFoReport(report.date);
      continue;
    }
    let underlyingClose = legRows.find((row) => (row?.underlyingPrice ?? 0) > 0)?.underlyingPrice ?? 0;
    if (underlyingClose <= 0) underlyingClose = (await fetchCmReport(report.date))?.find((row) => row.ticker === ticker && row.series === 'EQ')?.close ?? 0;
    if (underlyingClose <= 0) {
      skippedSessions += 1;
      releaseFoReport(report.date);
      continue;
    }
    const actualPnl = legs.reduce((sum, leg, index) => sum + leg.side * leg.quantity * ((legRows[index]?.close ?? 0) - leg.entryPrice) * lotSize, 0);
    const years = yearsToExpiry(report.date, expiryDate);
    const volatilities = legs.map((leg, index) => impliedVolatility(legRows[index]?.close ?? 0, underlyingClose, leg.strike, years, leg.optionType));
    const dayXValues = [...new Set([...xValues, underlyingClose, ...strikes.filter((strike) => strike >= xMin && strike <= xMax)])].sort((a, b) => a - b);
    const curve = dayXValues.map((underlying): StrategyLabPoint => {
      const expiryPnl = legs.reduce((sum, leg) => {
        const intrinsic = leg.optionType === 'CE' ? Math.max(underlying - leg.strike, 0) : Math.max(leg.strike - underlying, 0);
        return sum + leg.side * leg.quantity * (intrinsic - leg.entryPrice) * lotSize;
      }, 0);
      const selectedDayPnl = legs.reduce((sum, leg, index) => {
        const modelPrice = optionValue(underlying, leg.strike, years, volatilities[index], leg.optionType);
        return sum + leg.side * leg.quantity * (modelPrice - leg.entryPrice) * lotSize;
      }, 0);
      return { underlying: round(underlying), expiryPnl: round(expiryPnl), selectedDayPnl: round(selectedDayPnl) };
    });
    const atmIndex = strikes.reduce((nearest, strike, index) => Math.abs(strike - underlyingClose) < Math.abs(strikes[nearest] - underlyingClose) ? index : nearest, 0);
    const oiIndexes = new Set(Array.from({ length: 17 }, (_, index) => atmIndex - 8 + index).filter((index) => index >= 0 && index < strikes.length));
    const openInterest = [...oiIndexes].map((index) => {
      const strike = strikes[index];
      const call = byContract.get(contractKey('CE', strike));
      const put = byContract.get(contractKey('PE', strike));
      return { strike, callOi: call?.openInterest ?? 0, putOi: put?.openInterest ?? 0, callOiChange: call?.changeInOpenInterest ?? 0, putOiChange: put?.changeInOpenInterest ?? 0 };
    });
    days.push({
      date: report.date,
      underlyingClose: round(underlyingClose),
      actualPnl: round(actualPnl),
      modelPnlAtSpot: round(actualPnl),
      curve,
      openInterest,
      legMarks: legs.map((leg, index) => ({ symbol: leg.symbol, close: legRows[index]!.close, openInterest: legRows[index]!.openInterest, changeInOpenInterest: legRows[index]!.changeInOpenInterest })),
    });
    releaseFoReport(report.date);
  }
  if (!days.length) throw new Error('No trading day had complete closing prices for every strategy leg.');

  return {
    ticker,
    requestedStartDate,
    entryDate,
    expiryDate,
    strategy: strategyKey,
    strategyLabel: definition.label,
    lotSize,
    entryUnderlying: round(entryUnderlying),
    entryNetPremium: round(entryNetPremium),
    capitalAtRiskLabel: definition.risk,
    ...metrics,
    legs,
    days,
    skippedSessions,
    source: 'NSE F&O UDiFF daily bhavcopy',
    methodology: 'Entry and selected-day P&L use actual NSE daily option closes. The selected-day curve uses Black–Scholes implied volatility solved independently from each observed leg close; the expiry curve uses intrinsic value. OI is the reported end-of-day open interest for each strike.',
  };
}

export async function syncStrategyLabData(ticker: string, requestedStartDate: string, strategyKey: StrategyKey): Promise<StrategyLabSync> {
  clearNseReportCaches();
  try {
    const setup = await loadStrategyLabSetup(ticker, requestedStartDate, strategyKey);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const availableThrough = setup.expiryDate < today ? setup.expiryDate : today;
    const reports = await loadReports(calendarDates(setup.entryDate, availableThrough), ticker, setup.expiryDate, true, true);
    if (!reports.length) throw new Error('NSE has not published any usable option reports for this selected cycle.');
    return {
      ticker,
      expiryDate: setup.expiryDate,
      sessionsStored: reports.length,
      optionRowsStored: reports.reduce((sum, report) => sum + report.rows.length, 0),
      latestStoredDate: reports.at(-1)!.date,
      syncedAt: new Date().toISOString(),
      source: 'NSE F&O UDiFF bhavcopy stored in backend D1',
    };
  } finally {
    clearNseReportCaches();
  }
}

export function isStrategyKey(value: string): value is StrategyKey {
  return value in strategyDefinitions;
}
