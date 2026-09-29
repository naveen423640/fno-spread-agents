import { calendarDates, clearFoReportCache, discoverCompletedMonthlyCycles, fetchCmReport, fetchFoReport, rankHistoricalUniverse, releaseFoReport } from './nse-data';
import type { ContractSnapshot, FoRow, ResearchConfiguration } from './types';

export type DailyMark = { date: string; spreadValue: number; grossPnl: number; pnlPercent: number; pnlR: number };
export type DailyTrade = {
  cycle: string; expiryDate: string; entryDate: string; t1TradingDay: string; stockSymbol: string; direction: 'BULL_CALL' | 'BEAR_PUT';
  longSymbol: string; shortSymbol: string; longStrike: number; shortStrike: number; lotSize: number;
  longEntryOpen: number; shortEntryOpen: number; netDebit: number; spreadWidth: number; maximumLoss: number; maximumProfit: number; breakeven: number; actualRewardRisk: number;
  marks: DailyMark[];
};
export type SimulatedOutcome = { exitDate: string; exitReason: 'TARGET' | 'STOP' | 'FORCED_T1'; grossPnl: number; netPnl: number; pnlR: number; holdingDays: number; maePercent: number; maeR: number };

type Progress = (percent: number, message: string) => Promise<void> | void;

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

function rowByContract(rows: FoRow[], symbol: string) {
  const instrumentName = symbol.replace(/^NSE:/, '');
  return rows.find((row) => row.instrumentName === instrumentName);
}

function executableOpen(row: FoRow | undefined) {
  return row && row.tradedVolume > 0 && row.open > 0 ? row.open : null;
}

function executableClose(row: FoRow | undefined) {
  return row && row.tradedVolume > 0 && row.close > 0 ? row.close : null;
}

function candidateContracts(contracts: ContractSnapshot[], underlyingOpen: number, direction: DailyTrade['direction']) {
  const paired = [...new Set(contracts.map((contract) => contract.strike))].filter((strike) => contracts.some((contract) => contract.strike === strike && contract.optionType === 'CE') && contracts.some((contract) => contract.strike === strike && contract.optionType === 'PE'));
  if (!paired.length) return null;
  const atm = paired.reduce((best, strike) => Math.abs(strike - underlyingOpen) < Math.abs(best - underlyingOpen) ? strike : best, paired[0]);
  const optionType = direction === 'BULL_CALL' ? 'CE' : 'PE';
  const shortStrikes = paired.filter((strike) => direction === 'BULL_CALL' ? strike > atm : strike < atm).sort((a, b) => direction === 'BULL_CALL' ? a - b : b - a);
  const long = contracts.find((contract) => contract.strike === atm && contract.optionType === optionType);
  return long ? { atm, long, short: shortStrikes.map((strike) => contracts.find((contract) => contract.strike === strike && contract.optionType === optionType)).filter((contract): contract is ContractSnapshot => Boolean(contract)) } : null;
}

function buildTrade(cycle: Awaited<ReturnType<typeof discoverCompletedMonthlyCycles>>[number], stock: ReturnType<typeof rankHistoricalUniverse>[number], direction: DailyTrade['direction'], underlyingOpen: number, reports: Map<string, FoRow[]>, configuration: ResearchConfiguration) {
  if (!stock.lotSize) return null;
  const contractSet = candidateContracts(stock.contracts, underlyingOpen, direction);
  if (!contractSet) return null;
  const entryRows = reports.get(cycle.firstEligibleTradingDay) ?? [];
  const t1Rows = reports.get(cycle.t1TradingDay) ?? [];
  const longEntry = executableOpen(rowByContract(entryRows, contractSet.long.fyersSymbol));
  if (longEntry === null) return null;
  for (const shortContract of contractSet.short) {
    const shortEntry = executableOpen(rowByContract(entryRows, shortContract.fyersSymbol));
    const longT1 = executableClose(rowByContract(t1Rows, contractSet.long.fyersSymbol));
    const shortT1 = executableClose(rowByContract(t1Rows, shortContract.fyersSymbol));
    if (shortEntry === null || longT1 === null || shortT1 === null) continue;
    const width = Math.abs(shortContract.strike - contractSet.atm);
    const perUnitSlippage = configuration.slippagePerLeg / stock.lotSize;
    const debit = longEntry - shortEntry + (2 * perUnitSlippage);
    if (!(debit > 0 && debit < width)) continue;
    const rewardRisk = (width - debit) / debit;
    if (rewardRisk < configuration.minimumRewardRisk) continue;
    const marks: DailyMark[] = [];
    for (const date of calendarDates(cycle.firstEligibleTradingDay, cycle.t1TradingDay)) {
      const rows = reports.get(date);
      if (!rows) continue;
      const longClose = executableClose(rowByContract(rows, contractSet.long.fyersSymbol));
      const shortClose = executableClose(rowByContract(rows, shortContract.fyersSymbol));
      if (longClose === null || shortClose === null) continue;
      const rawSpreadValue = longClose - shortClose;
      if (rawSpreadValue < 0 || rawSpreadValue > width) continue;
      const spreadValue = Math.max(0, rawSpreadValue - (2 * perUnitSlippage));
      const grossPnl = (spreadValue - debit) * stock.lotSize;
      marks.push({ date, spreadValue: round(spreadValue), grossPnl: round(grossPnl, 2), pnlPercent: round((grossPnl / (debit * stock.lotSize)) * 100, 2), pnlR: round(grossPnl / (debit * stock.lotSize)) });
    }
    if (!marks.some((mark) => mark.date === cycle.t1TradingDay)) continue;
    return {
      cycle: cycle.expiryDate.slice(0, 7), expiryDate: cycle.expiryDate, entryDate: cycle.firstEligibleTradingDay, t1TradingDay: cycle.t1TradingDay,
      stockSymbol: stock.ticker, direction, longSymbol: contractSet.long.fyersSymbol, shortSymbol: shortContract.fyersSymbol,
      longStrike: contractSet.atm, shortStrike: shortContract.strike, lotSize: stock.lotSize, longEntryOpen: longEntry, shortEntryOpen: shortEntry,
      netDebit: round(debit), spreadWidth: width, maximumLoss: round(debit * stock.lotSize, 2), maximumProfit: round((width - debit) * stock.lotSize, 2),
      breakeven: round(direction === 'BULL_CALL' ? contractSet.atm + debit : contractSet.atm - debit), actualRewardRisk: round(rewardRisk), marks,
    } satisfies DailyTrade;
  }
  return null;
}

export function simulateDailyTrade(trade: DailyTrade, costs: number, targetPercent = 80, stopPercent: number | null = null): SimulatedOutcome {
  const targetPnl = trade.maximumProfit * (targetPercent / 100);
  let selected = trade.marks.at(-1)!;
  let exitReason: SimulatedOutcome['exitReason'] = 'FORCED_T1';
  let maePercent = 0;
  let maeR = 0;
  for (const mark of trade.marks) {
    maePercent = Math.min(maePercent, mark.pnlPercent);
    maeR = Math.min(maeR, mark.pnlR);
    if (mark.grossPnl >= targetPnl) { selected = mark; exitReason = 'TARGET'; break; }
    if (stopPercent !== null && mark.pnlPercent <= stopPercent) { selected = mark; exitReason = 'STOP'; break; }
  }
  return { exitDate: selected.date, exitReason, grossPnl: selected.grossPnl, netPnl: round(selected.grossPnl - costs, 2), pnlR: round((selected.grossPnl - costs) / trade.maximumLoss), holdingDays: daysBetween(trade.entryDate, selected.date), maePercent: round(maePercent, 2), maeR: round(maeR) };
}

function maximumDrawdown(values: number[]) {
  let equity = 0, peak = 0, drawdown = 0;
  for (const value of values) { equity += value; peak = Math.max(peak, equity); drawdown = Math.min(drawdown, equity - peak); }
  return drawdown;
}

function metrics(rows: { trade: DailyTrade; outcome: SimulatedOutcome }[]) {
  const pnls = rows.map((row) => row.outcome.netPnl);
  const winners = pnls.filter((value) => value > 0), losers = pnls.filter((value) => value < 0);
  const grossProfit = winners.reduce((sum, value) => sum + value, 0), grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  return {
    trades: rows.length,
    targetHits: rows.filter((row) => row.outcome.exitReason === 'TARGET').length,
    targetHitRate: rows.length ? round((rows.filter((row) => row.outcome.exitReason === 'TARGET').length / rows.length) * 100, 2) : 0,
    profitableTradeRate: rows.length ? round((winners.length / rows.length) * 100, 2) : 0,
    averageWinner: winners.length ? round(winners.reduce((sum, value) => sum + value, 0) / winners.length, 2) : 0,
    averageLoser: losers.length ? round(losers.reduce((sum, value) => sum + value, 0) / losers.length, 2) : 0,
    expectancy: rows.length ? round(pnls.reduce((sum, value) => sum + value, 0) / rows.length, 2) : 0,
    profitFactor: grossLoss ? round(grossProfit / grossLoss) : null,
    netPnl: round(pnls.reduce((sum, value) => sum + value, 0), 2),
    averageR: rows.length ? round(rows.reduce((sum, row) => sum + row.outcome.pnlR, 0) / rows.length) : 0,
    totalR: round(rows.reduce((sum, row) => sum + row.outcome.pnlR, 0)),
    medianR: round(median(rows.map((row) => row.outcome.pnlR))),
    maximumDrawdown: round(maximumDrawdown([...rows].sort((a, b) => a.outcome.exitDate.localeCompare(b.outcome.exitDate)).map((row) => row.outcome.netPnl)), 2),
    maximumDrawdownR: round(maximumDrawdown(rows.map((row) => row.outcome.pnlR))),
    averageHoldingDays: rows.length ? round(rows.reduce((sum, row) => sum + row.outcome.holdingDays, 0) / rows.length, 2) : 0,
  };
}

function grouped<T extends string>(rows: { trade: DailyTrade; outcome: SimulatedOutcome }[], keys: T[], keyOf: (row: { trade: DailyTrade; outcome: SimulatedOutcome }) => T) {
  return keys.map((key) => ({ group: key, ...metrics(rows.filter((row) => keyOf(row) === key)) }));
}

export function buildDailyReport(trades: DailyTrade[], configuration: ResearchConfiguration) {
  const primary = trades.map((trade) => ({ trade, outcome: simulateDailyTrade(trade, configuration.roundTripCosts) }));
  const rrBands = ['1.50–1.75', '1.75–2.00', '2.00–2.25', '2.25–2.50', '2.50–3.00', '>=3.00'] as const;
  const rrBand = (rr: number): typeof rrBands[number] => rr < 1.75 ? '1.50–1.75' : rr < 2 ? '1.75–2.00' : rr < 2.25 ? '2.00–2.25' : rr < 2.5 ? '2.25–2.50' : rr < 3 ? '2.50–3.00' : '>=3.00';
  const maeBuckets = ['Never reached -25%', 'Reached -25%', 'Reached -50%', 'Reached -75%', 'Reached -90%', 'Reached approximately -100%'] as const;
  const maeBucket = (value: number): typeof maeBuckets[number] => value <= -99 ? 'Reached approximately -100%' : value <= -90 ? 'Reached -90%' : value <= -75 ? 'Reached -75%' : value <= -50 ? 'Reached -50%' : value <= -25 ? 'Reached -25%' : 'Never reached -25%';
  const recovery = (direction: 'BULL_CALL' | 'BEAR_PUT' | 'COMBINED') => {
    const source = primary.filter((row) => direction === 'COMBINED' || row.trade.direction === direction);
    const worthless = source.filter((row) => row.outcome.maePercent <= -99);
    const details = worthless.map((row) => {
      const first = row.trade.marks.findIndex((mark) => mark.pnlPercent <= -99);
      const later = row.trade.marks.slice(first + 1);
      return { aboveZero: later.some((mark) => mark.grossPnl > 0), target50: later.some((mark) => mark.grossPnl >= row.trade.maximumProfit * 0.5), target80: later.some((mark) => mark.grossPnl >= row.trade.maximumProfit * 0.8), remainingDays: first >= 0 ? daysBetween(row.trade.marks[first].date, row.trade.t1TradingDay) : 0, final: row.outcome.netPnl };
    });
    return { direction, trades: source.length, reachedApproximately100: worthless.length, percentageOfTrades: source.length ? round((worthless.length / source.length) * 100, 2) : 0, recoveredAboveZero: details.filter((row) => row.aboveZero).length, reached50Target: details.filter((row) => row.target50).length, reached80Target: details.filter((row) => row.target80).length, recoveryPercent: details.length ? round((details.filter((row) => row.aboveZero).length / details.length) * 100, 2) : 0, target80RecoveryPercent: details.length ? round((details.filter((row) => row.target80).length / details.length) * 100, 2) : 0, remainingLosers: details.filter((row) => row.final < 0).length, averageFinalPnl: details.length ? round(details.reduce((sum, row) => sum + row.final, 0) / details.length, 2) : 0, medianFinalPnl: round(median(details.map((row) => row.final)), 2), averageDaysRemaining: details.length ? round(details.reduce((sum, row) => sum + row.remainingDays, 0) / details.length, 2) : 0, medianDaysRemaining: round(median(details.map((row) => row.remainingDays)), 2) };
  };
  const months = [...new Set(trades.map((trade) => trade.cycle))].sort();
  const stocks = [...new Set(trades.map((trade) => trade.stockSymbol))].sort();
  const targetSensitivity = [50, 60, 70, 80, 90, 100].map((target) => ({ targetPercent: target, ...metrics(trades.map((trade) => ({ trade, outcome: simulateDailyTrade(trade, configuration.roundTripCosts, target) }))) }));
  const stopControls = [null, -50, -75, -100].map((stop) => ({ stopPercent: stop, label: stop === null ? 'NO_SL' : `${stop}%`, ...metrics(trades.map((trade) => ({ trade, outcome: simulateDailyTrade(trade, configuration.roundTripCosts, 80, stop) }))) }));
  const mae = maeBuckets.map((bucket) => {
    const rows = primary.filter((row) => maeBucket(row.outcome.maePercent) === bucket);
    return { bucket, trades: rows.length, percentage: primary.length ? round((rows.length / primary.length) * 100, 2) : 0, laterReached80: rows.filter((row) => row.outcome.exitReason === 'TARGET').length, recoveryRate: rows.length ? round((rows.filter((row) => row.outcome.exitReason === 'TARGET').length / rows.length) * 100, 2) : 0, averageFinalPnl: rows.length ? round(rows.reduce((sum, row) => sum + row.outcome.netPnl, 0) / rows.length, 2) : 0, medianFinalPnl: round(median(rows.map((row) => row.outcome.netPnl)), 2) };
  });
  const monthRows = months.flatMap((month) => (['BULL_CALL', 'BEAR_PUT', 'COMBINED'] as const).map((direction) => ({ month, direction, ...metrics(primary.filter((row) => row.trade.cycle === month && (direction === 'COMBINED' || row.trade.direction === direction))) })));
  const stockRows = stocks.map((stock) => ({ stock, appearances: new Set(primary.filter((row) => row.trade.stockSymbol === stock).map((row) => row.trade.cycle)).size, combined: metrics(primary.filter((row) => row.trade.stockSymbol === stock)), bullCall: metrics(primary.filter((row) => row.trade.stockSymbol === stock && row.trade.direction === 'BULL_CALL')), bearPut: metrics(primary.filter((row) => row.trade.stockSymbol === stock && row.trade.direction === 'BEAR_PUT')) }));
  const allEntryDates = [...new Set(trades.map((trade) => trade.entryDate))];
  const simultaneousRisk = allEntryDates.map((date) => trades.filter((trade) => trade.entryDate === date).reduce((sum, trade) => sum + trade.maximumLoss, 0));
  return {
    methodology: { mode: 'DAILY_PROXY', entry: 'Entry-day first traded option price (daily open)', valuation: 'Daily closing prices only when both legs traded', targetDetection: 'First daily close meeting target', forcedExit: 'T-1 daily close', executionQuality: 'LTP_FALLBACK', slippage: 'Applied to both legs at entry and exit', intradayStatisticsAvailable: false },
    table1Overall: metrics(primary),
    table2Direction: [...grouped(primary, ['BULL_CALL', 'BEAR_PUT'], (row) => row.trade.direction), { group: 'COMBINED', ...metrics(primary) }],
    table3RewardRisk: rrBands.map((band) => ({ band, ...metrics(primary.filter((row) => rrBand(row.trade.actualRewardRisk) === band)) })),
    table4TargetSensitivity: targetSensitivity,
    table5StopControls: stopControls,
    table6MaeRecovery: mae,
    table7WorthlessRecovery: [recovery('BULL_CALL'), recovery('BEAR_PUT'), recovery('COMBINED')],
    table8Monthly: monthRows,
    table9Stocks: stockRows,
    table10Portfolio: { trades: trades.length, entryCohorts: allEntryDates.length, maximumSimultaneousPositions: Math.max(0, ...allEntryDates.map((date) => trades.filter((trade) => trade.entryDate === date).length)), maximumSimultaneousTheoreticalRisk: round(Math.max(0, ...simultaneousRisk), 2), oneSpreadPerStockMonth: metrics(primary), equalRisk: { averageR: metrics(primary).averageR, totalR: metrics(primary).totalR, medianR: metrics(primary).medianR, maximumDrawdownR: metrics(primary).maximumDrawdownR }, dailyPortfolioMtm: null, dailyPortfolioMtmReason: 'A complete synchronized daily mark is unavailable whenever either option leg did not trade; values were not interpolated.' },
  };
}

export async function runDailyProxy(configuration: ResearchConfiguration, today?: string, progress?: Progress) {
  await progress?.(5, 'Discovering six completed monthly cycles.');
  const cycles = await discoverCompletedMonthlyCycles(today, configuration.completedCycles);
  clearFoReportCache();
  const trades: DailyTrade[] = [];
  const exclusions: Record<string, number> = {};
  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
    const cycle = cycles[cycleIndex];
    const universe = rankHistoricalUniverse(cycle, configuration.stocksPerCycle);
    const relevantTickers = new Set(universe.map((stock) => stock.ticker));
    const reports = new Map<string, FoRow[]>();
    const cycleDates = calendarDates(cycle.firstEligibleTradingDay, cycle.t1TradingDay);
    for (let dateIndex = 0; dateIndex < cycleDates.length; dateIndex += 1) {
      const date = cycleDates[dateIndex];
      const rows = await fetchFoReport(date);
      if (rows) reports.set(date, rows.filter((row) => row.instrumentType === 'STO' && row.expiryDate === cycle.expiryDate && relevantTickers.has(row.ticker)));
      releaseFoReport(date);
      if ((dateIndex + 1) % 7 === 0) await progress?.(10 + Math.round(((cycleIndex + (dateIndex + 1) / cycleDates.length) / cycles.length) * 75), `Loaded daily contracts for ${cycle.expiryDate}: ${dateIndex + 1}/${cycleDates.length} calendar days.`);
    }
    const cashRows = await fetchCmReport(cycle.firstEligibleTradingDay);
    if (!cashRows) throw new Error(`Cash bhavcopy is missing for ${cycle.firstEligibleTradingDay}.`);
    for (const stock of universe) {
      const underlying = cashRows.find((row) => row.ticker === stock.ticker && row.series === 'EQ');
      if (!underlying?.open) { exclusions.MISSING_UNDERLYING_OPEN = (exclusions.MISSING_UNDERLYING_OPEN ?? 0) + 2; continue; }
      for (const direction of ['BULL_CALL', 'BEAR_PUT'] as const) {
        const trade = buildTrade(cycle, stock, direction, underlying.open, reports, configuration);
        if (trade) trades.push(trade); else exclusions.NO_EXECUTABLE_TWO_TO_ONE_SPREAD = (exclusions.NO_EXECUTABLE_TWO_TO_ONE_SPREAD ?? 0) + 1;
      }
    }
    reports.clear();
    cycle.rankingRows = [];
    await progress?.(10 + Math.round(((cycleIndex + 1) / cycles.length) * 75), `Built ${trades.length} executable daily-proxy trades through ${cycle.expiryDate}.`);
  }
  const report = buildDailyReport(trades, configuration);
  await progress?.(95, 'Aggregating daily-proxy research tables.');
  return { cycles: cycles.map(({ rankingRows: _rankingRows, ...cycle }) => cycle), expectedCandidates: configuration.completedCycles * configuration.stocksPerCycle * 2, executableTrades: trades.length, exclusions, trades, report };
}
