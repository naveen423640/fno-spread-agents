import { db, ensureSchema, saveConfiguration } from './repository';
import { discoverCompletedMonthlyCycles, rankHistoricalUniverse } from './nse-data';
import { findEntryCandle, getFyersHistory } from './fyers-data';
import type { ContractSnapshot, ResearchConfiguration } from './types';

type Credentials = { clientId: string; accessToken: string };
type StoredCycle = { id: number; expiryDate: string; entryTimestamp: string; firstEligibleTradingDay: string; t1TradingDay: string };
type StoredUniverse = { cycleId: number; ticker: string; lotSize: number | null; contracts: ContractSnapshot[] };

const liquidityMethodology = 'NSE F&O UDiFF bhavcopy total traded value on the trading day before entry; only stock-option underlyings and contracts for that cycle expiry are eligible.';

async function updateRun(runId: string, status: string, phase: string, progress: number, summary: string, complete = false) {
  await db().prepare('UPDATE preflight_runs SET status=?, phase=?, progress_percent=?, summary=?, completed_at=? WHERE id=?')
    .bind(status, phase, progress, summary, complete ? new Date().toISOString() : null, runId).run();
}

async function quality(runId: string, severity: 'PASS' | 'WARNING' | 'FAIL', code: string, scope: string, message: string, details: unknown = {}, cycleId: number | null = null, stockSymbol: string | null = null) {
  await db().prepare('INSERT INTO data_quality_results (run_id,severity,code,scope,cycle_id,stock_symbol,message,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(runId, severity, code, scope, cycleId, stockSymbol, message, JSON.stringify(details), new Date().toISOString()).run();
}

function selectedContracts(contracts: ContractSnapshot[], underlyingPrice: number) {
  const strikes = [...new Set(contracts.map((contract) => contract.strike))].sort((a, b) => a - b);
  const paired = strikes.filter((strike) => contracts.some((contract) => contract.strike === strike && contract.optionType === 'CE') && contracts.some((contract) => contract.strike === strike && contract.optionType === 'PE'));
  const atmStrike = paired.reduce((best, strike) => Math.abs(strike - underlyingPrice) < Math.abs(best - underlyingPrice) ? strike : best, paired[0]);
  if (atmStrike === undefined) return { atmStrike: null, contracts: [], higherCe: [], lowerPe: [] };
  const higherCe = strikes.filter((strike) => strike > atmStrike).slice(0, 3);
  const lowerPe = strikes.filter((strike) => strike < atmStrike).slice(-3).reverse();
  const wanted = [{ strike: atmStrike, optionType: 'CE' as const }, { strike: atmStrike, optionType: 'PE' as const }, ...higherCe.map((strike) => ({ strike, optionType: 'CE' as const })), ...lowerPe.map((strike) => ({ strike, optionType: 'PE' as const }))];
  return { atmStrike, higherCe, lowerPe, contracts: wanted.map((wantedContract) => contracts.find((contract) => contract.strike === wantedContract.strike && contract.optionType === wantedContract.optionType)).filter((contract): contract is ContractSnapshot => Boolean(contract)) };
}

function boundedCandles(candles: number[][], entryTimestamp: string, t1TradingDay: string) {
  const from = Math.floor(new Date(entryTimestamp).getTime() / 1000);
  const to = Math.floor(new Date(`${t1TradingDay}T15:15:00+05:30`).getTime() / 1000);
  return candles.filter((candle) => candle[0] >= from && candle[0] <= to);
}

async function storeOptionMetadata(runId: string, cycle: StoredCycle, stock: StoredUniverse, contract: ContractSnapshot, expectedTimestamps: Set<number>, candles: number[][]) {
  const covered = candles.filter((candle) => expectedTimestamps.has(candle[0]));
  const actualTimestamps = new Set(covered.map((candle) => candle[0]));
  const expected = expectedTimestamps.size;
  const actual = actualTimestamps.size;
  const missing = Math.max(0, expected - actual);
  const completeness = expected ? Number(((actual / expected) * 100).toFixed(2)) : 0;
  await db().prepare(`INSERT INTO option_data_metadata (run_id,cycle_id,stock_symbol,expiry_date,option_type,strike,fyers_symbol,coverage_start,coverage_end,expected_points,actual_points,missing_intervals,completeness_percent,execution_quality)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(runId, cycle.id, stock.ticker, cycle.expiryDate, contract.optionType, contract.strike, contract.fyersSymbol,
      covered.length ? new Date(covered[0][0] * 1000).toISOString() : null, covered.length ? new Date(covered.at(-1)![0] * 1000).toISOString() : null,
      expected, actual, missing, completeness, 'LTP_FALLBACK').run();
  return { contract, candles: covered, completeness };
}

async function storeSpread(runId: string, cycle: StoredCycle, stock: StoredUniverse, direction: 'BULL_CALL' | 'BEAR_PUT', atmStrike: number | null, shortStrike: number | null, availableStrikes: number[], longPrice: number | null, shortPrice: number | null, configuration: ResearchConfiguration, reason?: string) {
  const width = atmStrike !== null && shortStrike !== null ? Math.abs(shortStrike - atmStrike) : null;
  const debit = longPrice !== null && shortPrice !== null && stock.lotSize ? Number((longPrice - shortPrice + ((2 * configuration.slippagePerLeg) / stock.lotSize)).toFixed(4)) : null;
  const maxLoss = debit !== null && debit > 0 && stock.lotSize ? debit * stock.lotSize : null;
  const maxProfit = width !== null && debit !== null && debit > 0 && width > debit && stock.lotSize ? (width - debit) * stock.lotSize : null;
  const rewardRisk = maxLoss && maxProfit !== null ? maxProfit / maxLoss : null;
  const breakeven = atmStrike !== null && debit !== null ? direction === 'BULL_CALL' ? atmStrike + debit : atmStrike - debit : null;
  const feasible = Boolean(!reason && rewardRisk !== null && rewardRisk >= configuration.minimumRewardRisk);
  const finalReason = reason ?? (rewardRisk === null ? 'Historical 09:20 prices are missing.' : feasible ? `Actual R:R ${rewardRisk.toFixed(2)} meets the minimum.` : `Actual R:R ${rewardRisk.toFixed(2)} is below ${configuration.minimumRewardRisk.toFixed(2)}.`);
  await db().prepare(`INSERT INTO spread_candidates (run_id,cycle_id,stock_symbol,direction,atm_strike,short_strike,available_strikes_json,net_debit,spread_width,maximum_loss,maximum_profit,breakeven,actual_reward_risk,lot_size,feasible,reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(runId, cycle.id, stock.ticker, direction, atmStrike, shortStrike, JSON.stringify(availableStrikes), debit, width, maxLoss, maxProfit, breakeven, rewardRisk, stock.lotSize, feasible ? 1 : 0, finalReason).run();
  return feasible;
}

async function processCandidate(runId: string, cycle: StoredCycle, stock: StoredUniverse, credentials: Credentials, configuration: ResearchConfiguration) {
  if (!stock.lotSize) {
    await quality(runId, 'FAIL', 'MISSING_LOT_SIZE', 'spread_reconstruction', 'NSE contract snapshot has no usable lot size.', {}, cycle.id, stock.ticker);
    return { covered: false, systemicFailure: false };
  }
  const underlying = await getFyersHistory(credentials, `NSE:${stock.ticker}-EQ`, cycle.firstEligibleTradingDay, cycle.t1TradingDay);
  if (!underlying.ok) {
    await quality(runId, 'FAIL', 'UNDERLYING_HISTORY_UNAVAILABLE', 'option_coverage', `FYERS underlying minute history failed: ${underlying.message ?? 'unknown error'}.`, { code: underlying.code }, cycle.id, stock.ticker);
    return { covered: false, systemicFailure: underlying.code === -16 };
  }
  const underlyingWindow = boundedCandles(underlying.candles, cycle.entryTimestamp, cycle.t1TradingDay);
  const entryUnderlying = findEntryCandle(underlyingWindow, cycle.entryTimestamp);
  if (!entryUnderlying) {
    await quality(runId, 'FAIL', 'ENTRY_CANDLE_MISSING', 'option_coverage', 'FYERS has no exact 09:20 underlying candle for this stock-cycle.', {}, cycle.id, stock.ticker);
    return { covered: false, systemicFailure: false };
  }
  const selection = selectedContracts(stock.contracts, entryUnderlying[4]);
  if (selection.atmStrike === null || selection.higherCe.length === 0 || selection.lowerPe.length === 0) {
    await quality(runId, 'FAIL', 'INSUFFICIENT_STRIKES', 'spread_reconstruction', 'The pre-entry contract snapshot has insufficient paired ATM, higher CE, or lower PE strikes.', {}, cycle.id, stock.ticker);
    return { covered: false, systemicFailure: false };
  }
  const expectedTimestamps = new Set(underlyingWindow.map((candle) => candle[0]));
  const histories = await Promise.all(selection.contracts.map(async (contract) => ({ contract, history: await getFyersHistory(credentials, contract.fyersSymbol, cycle.firstEligibleTradingDay, cycle.t1TradingDay) })));
  const successful = histories.filter(({ history }) => history.ok);
  if (successful.length === 0) {
    const sample = histories[0]?.history;
    await quality(runId, 'FAIL', sample?.code === -16 ? 'FYERS_AUTHENTICATION_FAILED' : 'EXPIRED_OPTION_HISTORY_UNAVAILABLE', 'option_coverage', `FYERS returned no historical candles for exact archived option symbols. ${sample?.message ?? ''}`.trim(), { sampleSymbol: histories[0]?.contract.fyersSymbol, code: sample?.code }, cycle.id, stock.ticker);
    return { covered: false, systemicFailure: true };
  }
  const stored = await Promise.all(histories.map(async ({ contract, history }) => storeOptionMetadata(runId, cycle, stock, contract, expectedTimestamps, history.ok ? boundedCandles(history.candles, cycle.entryTimestamp, cycle.t1TradingDay) : [])));
  const entryPrices = new Map(stored.map(({ contract, candles }) => [`${contract.optionType}:${contract.strike}`, findEntryCandle(candles, cycle.entryTimestamp)?.[4] ?? null]));
  const longCall = entryPrices.get(`CE:${selection.atmStrike}`) ?? null;
  const longPut = entryPrices.get(`PE:${selection.atmStrike}`) ?? null;
  let feasible = false;
  for (const strike of selection.higherCe) feasible = (await storeSpread(runId, cycle, stock, 'BULL_CALL', selection.atmStrike, strike, selection.higherCe, longCall, entryPrices.get(`CE:${strike}`) ?? null, configuration)) || feasible;
  for (const strike of selection.lowerPe) feasible = (await storeSpread(runId, cycle, stock, 'BEAR_PUT', selection.atmStrike, strike, selection.lowerPe, longPut, entryPrices.get(`PE:${strike}`) ?? null, configuration)) || feasible;
  const complete = stored.every((item) => item.completeness >= 99);
  await db().prepare('UPDATE monthly_universe SET option_data_available=? WHERE cycle_id=? AND stock_symbol=?').bind(complete ? 1 : 0, cycle.id, stock.ticker).run();
  if (!complete) await quality(runId, 'FAIL', 'INSUFFICIENT_INTRADAY_COVERAGE', 'option_coverage', 'One or more required option contracts has less than 99% provider-aligned minute completeness.', { minimumCompletenessPercent: Math.min(...stored.map((item) => item.completeness)) }, cycle.id, stock.ticker);
  if (!feasible) await quality(runId, 'WARNING', 'NO_TWO_TO_ONE_SPREAD', 'spread_reconstruction', 'No tested adjacent spread met actual 2:1 R:R at 09:20 using LTP plus declared slippage.', {}, cycle.id, stock.ticker);
  return { covered: complete, systemicFailure: false };
}

export async function executePreflight(runId: string, credentials: Credentials, configuration: ResearchConfiguration, today?: string) {
  try {
    await updateRun(runId, 'RUNNING', 'monthly_cycles', 5, 'Discovering completed monthly stock-option cycles from historical reports.');
    const cycles = await discoverCompletedMonthlyCycles(today, configuration.completedCycles);
    if (cycles.length !== configuration.completedCycles) throw new Error(`Expected ${configuration.completedCycles} cycles but found ${cycles.length}.`);
    const storedCycles: StoredCycle[] = [];
    const allUniverse: StoredUniverse[] = [];
    for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
      const cycle = cycles[cycleIndex];
      const inserted = await db().prepare(`INSERT INTO monthly_cycles (run_id,cycle_order,expiry_date,first_eligible_trading_day,entry_timestamp,previous_trading_day,t1_trading_day) VALUES (?,?,?,?,?,?,?) RETURNING id`)
        .bind(runId, cycleIndex + 1, cycle.expiryDate, cycle.firstEligibleTradingDay, cycle.entryTimestamp, cycle.previousTradingDay, cycle.t1TradingDay).first<{ id: number }>();
      if (!inserted) throw new Error(`Could not persist cycle ${cycle.expiryDate}.`);
      const storedCycle = { id: inserted.id, expiryDate: cycle.expiryDate, entryTimestamp: cycle.entryTimestamp, firstEligibleTradingDay: cycle.firstEligibleTradingDay, t1TradingDay: cycle.t1TradingDay };
      storedCycles.push(storedCycle);
      const universe = rankHistoricalUniverse(cycle, configuration.stocksPerCycle);
      if (universe.length < configuration.stocksPerCycle) await quality(runId, 'FAIL', 'INSUFFICIENT_MONTHLY_UNIVERSE', 'monthly_universe', `Only ${universe.length} historically eligible stocks were identified; ${configuration.stocksPerCycle} are required.`, { expiryDate: cycle.expiryDate }, inserted.id);
      for (const stock of universe) {
        await db().prepare(`INSERT INTO monthly_universe (run_id,cycle_id,stock_symbol,liquidity_metric,liquidity_rank,fno_eligible,option_data_available,liquidity_methodology,lot_size,contract_snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(runId, inserted.id, stock.ticker, stock.liquidityMetric, stock.rank, 1, null, liquidityMethodology, stock.lotSize, JSON.stringify(stock.contracts)).run();
        allUniverse.push({ cycleId: inserted.id, ticker: stock.ticker, lotSize: stock.lotSize, contracts: stock.contracts });
      }
    }
    await quality(runId, 'PASS', 'MONTHLY_CYCLES_RECONSTRUCTED', 'monthly_cycles', `Detected ${storedCycles.length} completed monthly cycles dynamically.`, { expiries: storedCycles.map((cycle) => cycle.expiryDate) });
    await quality(runId, 'WARNING', 'FYERS_LIQUIDITY_RANKING_UNAVAILABLE', 'monthly_universe', 'FYERS does not expose a historical point-in-time F&O universe ranking; the deterministic fallback uses NSE F&O bhavcopy traded value from the prior trading day.', { methodology: liquidityMethodology });
    await quality(runId, 'WARNING', 'HISTORICAL_BID_ASK_UNAVAILABLE', 'execution_data', 'FYERS historical candles provide OHLCV, not historical bid/ask. Option execution is explicitly marked LTP_FALLBACK and applies the entered per-leg slippage.', { slippagePerLeg: configuration.slippagePerLeg, roundTripCosts: configuration.roundTripCosts });
    await updateRun(runId, 'RUNNING', 'systemic_option_gate', 25, `${allUniverse.length} stock-month snapshots stored. Testing an exact expired option symbol before the full coverage sweep.`);
    const gateCycle = storedCycles[0];
    const gateStock = allUniverse.find((stock) => stock.cycleId === gateCycle.id);
    if (!gateStock) throw new Error('The most recent cycle has no universe candidates.');
    const gate = await processCandidate(runId, gateCycle, gateStock, credentials, configuration);
    if (gate.systemicFailure) {
      await updateRun(runId, 'FAIL', 'complete', 100, 'Preflight failed at the systemic expired-option history gate. The backtest remains locked.', true);
      return;
    }
    let processed = 1;
    let covered = gate.covered ? 1 : 0;
    for (const cycle of storedCycles) {
      for (const stock of allUniverse.filter((candidate) => candidate.cycleId === cycle.id)) {
        if (cycle.id === gateCycle.id && stock.ticker === gateStock.ticker) continue;
        const result = await processCandidate(runId, cycle, stock, credentials, configuration);
        processed += 1;
        if (result.covered) covered += 1;
        if (result.systemicFailure) {
          await updateRun(runId, 'FAIL', 'complete', 100, `Preflight stopped after ${processed} stock-months because FYERS option history became systemically unavailable.`, true);
          return;
        }
        if (processed % 5 === 0) await updateRun(runId, 'RUNNING', 'option_coverage', 25 + Math.round((processed / allUniverse.length) * 70), `Verified ${processed}/${allUniverse.length} stock-month option datasets.`);
      }
    }
    const counts = await db().prepare("SELECT SUM(CASE WHEN severity='FAIL' THEN 1 ELSE 0 END) AS failures, SUM(CASE WHEN severity='WARNING' THEN 1 ELSE 0 END) AS warnings FROM data_quality_results WHERE run_id=?").bind(runId).first<{ failures: number; warnings: number }>();
    const status = counts?.failures ? 'FAIL' : counts?.warnings ? 'WARNING' : 'PASS';
    await updateRun(runId, status, 'complete', 100, `${covered}/${allUniverse.length} stock-months have at least 99% required option-minute coverage.`, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown preflight error.';
    await quality(runId, 'FAIL', 'PREFLIGHT_RUNTIME_ERROR', 'preflight', message);
    await updateRun(runId, 'FAIL', 'complete', 100, `Preflight failed: ${message}`, true);
  }
}

export async function createPreflightRun(credentials: Credentials, configuration: ResearchConfiguration, today?: string) {
  await ensureSchema();
  await saveConfiguration(configuration);
  const runId = crypto.randomUUID();
  await db().prepare('INSERT INTO preflight_runs (id,status,phase,progress_percent,summary,started_at,completed_at) VALUES (?,?,?,?,?,?,NULL)')
    .bind(runId, 'RUNNING', 'queued', 0, 'Preflight queued.', new Date().toISOString()).run();
  return { runId, task: executePreflight(runId, credentials, configuration, today) };
}
