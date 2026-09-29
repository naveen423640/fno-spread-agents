import { runDailyProxy, simulateDailyTrade } from './daily-engine';
import { db, ensureSchema, queryAll, saveConfiguration } from './repository';
import type { ResearchConfiguration } from './types';

async function updateDailyRun(runId: string, status: string, progress: number, summary: string) {
  await db().prepare('UPDATE daily_backtest_runs SET status=?,progress_percent=?,summary=? WHERE id=?').bind(status, progress, summary, runId).run();
}

export async function executeDailyRun(runId: string, configuration: ResearchConfiguration, today?: string) {
  try {
    const result = await runDailyProxy(configuration, today, (progress, summary) => updateDailyRun(runId, 'RUNNING', progress, summary));
    for (const trade of result.trades) {
      const outcome = simulateDailyTrade(trade, configuration.roundTripCosts);
      await db().prepare(`INSERT INTO daily_proxy_trades (run_id,cycle,expiry_date,entry_date,t1_trading_day,stock_symbol,direction,long_symbol,short_symbol,long_strike,short_strike,lot_size,net_debit,maximum_loss,maximum_profit,actual_reward_risk,outcome_json,marks_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(runId, trade.cycle, trade.expiryDate, trade.entryDate, trade.t1TradingDay, trade.stockSymbol, trade.direction, trade.longSymbol, trade.shortSymbol, trade.longStrike, trade.shortStrike, trade.lotSize, trade.netDebit, trade.maximumLoss, trade.maximumProfit, trade.actualRewardRisk, JSON.stringify(outcome), JSON.stringify(trade.marks)).run();
    }
    const summary = `${result.executableTrades}/${result.expectedCandidates} daily-proxy candidates produced executable 2:1 spreads.`;
    await db().prepare('UPDATE daily_backtest_runs SET status=?,progress_percent=100,summary=?,cycles_json=?,expected_candidates=?,executable_trades=?,exclusions_json=?,result_json=?,completed_at=? WHERE id=?')
      .bind('COMPLETE', summary, JSON.stringify(result.cycles), result.expectedCandidates, result.executableTrades, JSON.stringify(result.exclusions), JSON.stringify(result.report), new Date().toISOString(), runId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown daily-proxy error.';
    await db().prepare('UPDATE daily_backtest_runs SET status=?,progress_percent=100,summary=?,completed_at=? WHERE id=?').bind('FAIL', message, new Date().toISOString(), runId).run();
  }
}

export async function createDailyRun(configuration: ResearchConfiguration, today?: string) {
  await ensureSchema();
  await saveConfiguration(configuration);
  const runId = crypto.randomUUID();
  await db().prepare('INSERT INTO daily_backtest_runs (id,status,progress_percent,summary,configuration_json,started_at) VALUES (?,?,?,?,?,?)')
    .bind(runId, 'RUNNING', 0, 'Daily-proxy run queued.', JSON.stringify(configuration), new Date().toISOString()).run();
  return { runId, task: executeDailyRun(runId, configuration, today) };
}

export async function latestDailyRunId() {
  await ensureSchema();
  const [row] = await queryAll<{ id: string }>('SELECT id FROM daily_backtest_runs ORDER BY started_at DESC LIMIT 1');
  return row?.id ?? null;
}

export async function dailyRunResponse(runId: string, includeResult = false) {
  await ensureSchema();
  const [run] = await queryAll<Record<string, unknown>>('SELECT * FROM daily_backtest_runs WHERE id=?', runId);
  if (!run) return null;
  const payload = { ...run, mode: 'DAILY_PROXY' } as Record<string, unknown>;
  if (!includeResult) delete payload.result_json;
  else if (typeof payload.result_json === 'string') payload.result = JSON.parse(payload.result_json);
  if (typeof payload.cycles_json === 'string') payload.cycles = JSON.parse(payload.cycles_json);
  if (typeof payload.exclusions_json === 'string') payload.exclusions = JSON.parse(payload.exclusions_json);
  if (typeof payload.configuration_json === 'string') payload.configuration = JSON.parse(payload.configuration_json);
  delete payload.cycles_json;
  delete payload.exclusions_json;
  delete payload.configuration_json;
  delete payload.result_json;
  return payload;
}
