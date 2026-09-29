import { ensureSchema, queryAll } from '@/lib/backtest/repository';

export async function GET() {
  await ensureSchema();
  const [stored] = await queryAll<Record<string, unknown>>('SELECT * FROM research_configuration WHERE id=1');
  return Response.json(stored ?? { completed_cycles: 6, stocks_per_cycle: 50, entry_time_ist: '09:20', minimum_reward_risk: 2, stop_loss: 'NONE', profit_exit_percent: 80, forced_exit_time_ist: '15:15', slippage_per_leg: null, round_trip_costs: null }, { headers: { 'Cache-Control': 'no-store' } });
}
