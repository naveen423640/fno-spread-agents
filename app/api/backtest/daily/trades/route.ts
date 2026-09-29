import { latestDailyRunId } from '@/lib/backtest/daily-service';
import { queryAll } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('runId') ?? await latestDailyRunId();
  if (!runId) return Response.json({ runId: null, trades: [] });
  const stock = url.searchParams.get('stock');
  const direction = url.searchParams.get('direction');
  let sql = 'SELECT id,run_id,cycle,expiry_date,entry_date,t1_trading_day,stock_symbol,direction,long_symbol,short_symbol,long_strike,short_strike,lot_size,net_debit,maximum_loss,maximum_profit,actual_reward_risk,outcome_json FROM daily_proxy_trades WHERE run_id=?';
  const bindings: unknown[] = [runId];
  if (stock) { sql += ' AND stock_symbol=?'; bindings.push(stock.toUpperCase()); }
  if (direction) { sql += ' AND direction=?'; bindings.push(direction.toUpperCase()); }
  sql += ' ORDER BY entry_date,stock_symbol,direction';
  const rows = await queryAll<Record<string, unknown>>(sql, ...bindings);
  return Response.json({ runId, trades: rows.map((row) => ({ ...row, outcome: JSON.parse(row.outcome_json as string), outcome_json: undefined })) }, { headers: { 'Cache-Control': 'no-store' } });
}
