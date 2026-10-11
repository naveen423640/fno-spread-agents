'use client';

import { useEffect } from 'react';
import { Loader2, Play } from 'lucide-react';

import { RulesUsed } from '@/app/screener-rules';
import { useScreenerJob } from '@/app/screener-job';
import { Button } from '@/components/ui/button';
import type { ScreenerParams } from '@/lib/screener/config';
import type { RuleSet } from '@/lib/screener/rules';
import type { BacktestResult } from '@/lib/screener/service';
import { halvesVerdict, paramsEqual, rulesEqual, variantNotes } from '@/lib/screener/view';

const LABELS: Record<string, string> = {
  bull_full: 'Full rules (bull)',
  bull_no_trigger: 'No trigger (bull)',
  'oversold_only (RSI<30)': 'RSI below 30 only',
  oversold_in_uptrend: 'Oversold in an uptrend',
  uptrend_baseline: 'Uptrend baseline',
  bear_full: 'Full rules (bear)',
  custom_bull: 'Your bull rules',
  custom_bear: 'Your bear rules',
};
const fmt = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? 'n/a' : n.toFixed(digits));

export function ScreenerBacktest({ source, params, rules, rulesError, minTrades, onLogin }: { source: string; params: ScreenerParams; rules: RuleSet; rulesError: string; minTrades: number; onLogin: () => void }) {
  const { job, result, phase, error, busy, start } = useScreenerJob<BacktestResult>('backtest', source);
  useEffect(() => { if (phase === 'login') onLogin(); }, [phase, onLogin]);
  const staleSettings = job?.status === 'done' && (!paramsEqual(job.params, params) || !rulesEqual(result?.rules, rules));
  const blocked = rules.enabled && rulesError !== '';

  return (
    <div className="space-y-4">
      <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Options modelled with Black-Scholes and an IV proxy, indicative only. There are no real option prices, no skew, and a flat 2% slippage assumption. A positive result is a reason to paper-trade, not to size up.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void start(params, rules)} disabled={busy || blocked}>{busy ? <Loader2 className="animate-spin" /> : <Play />}{result ? 'Run backtest again' : 'Run backtest'}</Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {phase === 'running' && job ? `${job.message} (${job.progress}%)` : phase === 'failed' && job ? job.message : phase === 'login' ? 'Sign in to the broker, then run the backtest again.' : result ? `About ${params.holdDays}-session trades on 5 years of daily candles, as of ${result.asOf}.` : 'No backtest yet for this source. It loads up to 5 years of candles, so the first live run takes a few minutes.'}
        </p>
      </div>
      {phase === 'running' && job && <progress className="h-2 w-full accent-primary" value={job.progress} max={100} aria-label="Backtest progress" />}
      {blocked && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Your custom rules are not valid yet: {rulesError} Fix them in Settings, or turn custom rules off.</p>}
      {error && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {staleSettings && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This result was produced with different rules or settings from the ones now active. Run the backtest again to apply them.</p>}
      {result && <RulesUsed rules={result.rules} params={result.params} />}

      {result && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>{['Variant', 'Trades', 'Win rate %', 'Avg win (R)', 'Avg loss (R)', 'Expectancy (R)', 'Profit factor', '1st half exp. (R)', '2nd half exp. (R)', 'Halves'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {result.variants.map((v) => (
                  <tr key={v.name} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{LABELS[v.name] ?? v.name}<div className="text-xs font-normal text-muted-foreground">{v.side > 0 ? 'bull call' : 'bear put'}</div></td>
                    <td className="px-3 py-2 tabular-nums">{v.tradeCount}{v.lowSample && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900" title={`Fewer than ${minTrades} trades`}>low</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(v.stats.winRate, 1)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(v.stats.avgWinR)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(v.stats.avgLossR)}</td>
                    <td className={`px-3 py-2 tabular-nums font-semibold ${(v.stats.expectancyR ?? 0) > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(v.stats.expectancyR, 3)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(v.stats.profitFactor)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(v.firstHalf?.expectancyR, 3)} <span className="text-xs text-muted-foreground">(n={v.firstHalf?.n ?? 0})</span></td>
                    <td className="px-3 py-2 tabular-nums">{fmt(v.secondHalf?.expectancyR, 3)} <span className="text-xs text-muted-foreground">(n={v.secondHalf?.n ?? 0})</span></td>
                    <td className="px-3 py-2 text-xs">{halvesVerdict(v)}{variantNotes(v, minTrades).map((n) => <div key={n} className="mt-1 text-amber-800">{n}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{result.banner}</p>
            <p>R = return on the debit risked; expectancy above 0 means positive edge after the slippage assumption. Read it like this: the full rules should beat the RSI-below-30 and uptrend-baseline rows, be positive in both halves, and have {minTrades}+ trades before you trust them. If the full rules produce few signals, loosen one parameter at a time; do not tune until the result looks good.</p>
            {result.skipped.length > 0 && <p>{result.skipped.length} symbol(s) were skipped: {result.skipped.slice(0, 5).map((s) => `${s.symbol} (${s.reason})`).join('; ')}</p>}
          </div>
        </>
      )}
    </div>
  );
}
