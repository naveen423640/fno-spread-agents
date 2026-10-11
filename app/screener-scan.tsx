'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';

import { CandidateDrawer } from '@/app/screener-candidate';
import { RulesUsed } from '@/app/screener-rules';
import { useScreenerJob } from '@/app/screener-job';
import { Button } from '@/components/ui/button';
import type { ConfigView } from '@/lib/screener/api';
import type { ScreenerParams } from '@/lib/screener/config';
import type { RuleSet } from '@/lib/screener/rules';
import type { ScanResult } from '@/lib/screener/service';
import type { ScanRow } from '@/lib/screener/types';
import { DEFAULT_FILTERS, filterRows, paramsEqual, rulesEqual, rulesLabel, sectorsOf, type Filters } from '@/lib/screener/view';

const SELECT = 'h-9 rounded-lg border border-border bg-background px-3 text-sm';
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

export function ScreenerScan({ source, params, rules, rulesError, config, onLogin }: { source: string; params: ScreenerParams; rules: RuleSet; rulesError: string; config: ConfigView | null; onLogin: () => void }) {
  const { job, result, phase, error, busy, start } = useScreenerJob<ScanResult>('scan', source);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<ScanRow | null>(null);

  useEffect(() => { if (phase === 'login') onLogin(); }, [phase, onLogin]);

  const rows = useMemo(() => result?.rows ?? [], [result]);
  const sectors = useMemo(() => sectorsOf(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const staleSettings = job?.status === 'done' && (!paramsEqual(job.params, params) || !rulesEqual(result?.rules, rules));
  const blocked = rules.enabled && rulesError !== '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void start(params, rules)} disabled={busy || blocked}>{busy ? <Loader2 className="animate-spin" /> : <Play />}{result ? 'Run scan again' : 'Run scan'}</Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {phase === 'running' && job ? `${job.message} (${job.progress}%)` : phase === 'failed' && job ? job.message : phase === 'login' ? 'Sign in to the broker, then run the scan again.' : result ? `Scanned ${result.counts.symbols} stocks as of ${result.asOf} with ${rulesLabel(result.rules).toLowerCase()}: ${result.counts.signal} signal, ${result.counts.watch} watch. Strikes are for the ${result.expiry} expiry.` : 'No scan yet for this source.'}
        </p>
      </div>
      {phase === 'running' && job && <progress className="h-2 w-full accent-primary" value={job.progress} max={100} aria-label="Scan progress" />}
      {blocked && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Your custom rules are not valid yet: {rulesError} Fix them in Settings, or turn custom rules off.</p>}
      {error && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {staleSettings && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This result was produced with different rules or settings from the ones now active. Run the scan again to apply them.</p>}
      {result && <RulesUsed rules={result.rules} params={result.params} />}
      {result && result.skipped.length > 0 && <p className="text-xs text-muted-foreground">{result.skipped.length} symbol(s) were skipped: {result.skipped.slice(0, 5).map((s) => `${s.symbol} (${s.reason})`).join('; ')}{result.skipped.length > 5 ? '; …' : ''}</p>}

      {result && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">Side
              <select className={SELECT} value={filters.side} onChange={(e) => setFilters({ ...filters, side: e.target.value as Filters['side'] })}>
                <option value="ALL">All</option><option value="BULL CALL">Bull call</option><option value="BEAR PUT">Bear put</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">Sector
              <select className={SELECT} value={filters.sector} onChange={(e) => setFilters({ ...filters, sector: e.target.value })}>
                <option value="ALL">All</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">Status
              <select className={SELECT} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters['status'] })}>
                <option value="ALL">All</option><option value="SIGNAL">Signal</option><option value="WATCH">Watch</option>
              </select>
            </label>
            <p className="pb-2 text-xs text-muted-foreground">Showing {visible.length} of {rows.length}. At most 2 per sector per side. Sorted by status, then by relative strength.</p>
          </div>

          {rows.length === 0
            ? <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">No candidates today. That is a valid result: no trade is a position.</p>
            : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      {['Symbol', 'Sector', 'Side', 'Status', 'Close', 'RSI', 'RS vs Nifty %', 'Volume ×', 'Vol percentile', 'Long / short strike (approx)', 'Expiry', 'Lot'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={`${row.symbol}-${row.side}`} tabIndex={0} className="cursor-pointer border-t border-border hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none" onClick={() => setSelected(row)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(row); } }}>
                        <td className="px-3 py-2 font-semibold">{row.symbol}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.sector}</td>
                        <td className="px-3 py-2">{row.side === 'BULL CALL' ? 'Bull call' : 'Bear put'}</td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.status === 'SIGNAL' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{row.status}</span></td>
                        <td className="px-3 py-2 tabular-nums">{row.close.toFixed(1)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.rsi.toFixed(1)}</td>
                        <td className={`px-3 py-2 tabular-nums ${row.rs63Pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{signed(row.rs63Pct)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.volX.toFixed(2)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.hvPctile.toFixed(2)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.longStrikeApprox} / {row.shortStrikeApprox}</td>
                        <td className="px-3 py-2 tabular-nums">{row.expiry}</td>
                        <td className="px-3 py-2 tabular-nums">{row.lotSize ?? 'n/a'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <p className="text-xs text-muted-foreground">Strikes are approximate (spot and one expected move, rounded to the usual strike step). Check earnings and news dates manually for every name, then open a row to check live option quotes. The monthly expiry is computed as the last Tuesday: confirm it with your broker.</p>
        </>
      )}

      {selected && result && <CandidateDrawer key={`${selected.symbol}-${selected.side}`} row={selected} source={source} asOf={result.asOf} liveLabel={config?.sources.find((s) => s.id === source)?.label ?? source} params={params} onClose={() => setSelected(null)} />}
    </div>
  );
}
