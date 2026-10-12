'use client';

import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { LTP_CONFIG } from '@/lib/ltp/config';
import type { ChainView } from '@/lib/ltp/state';
import { highlightCells, type CellMark } from '@/lib/ltp/view';

const num = (v: number | null | undefined) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v));
const compact = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '–';
  const a = Math.abs(v);
  if (a >= 10_000_000) return `${(v / 10_000_000).toFixed(2)}Cr`;
  if (a >= 100_000) return `${(v / 100_000).toFixed(1)}L`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
};

const MARK_CLASS: Record<CellMark, string> = {
  max: 'bg-sky-500/20 font-semibold text-sky-800 dark:text-sky-300',
  second_weak: 'outline outline-2 -outline-offset-2 outline-yellow-400 bg-yellow-400/20 font-semibold',
};

export function LtpChainTable({ chain, analysis, methodLabel }: { chain: ChainView[]; analysis: UsableAnalysis; methodLabel: string }) {
  const marks = highlightCells(chain, analysis.levels.line, LTP_CONFIG.weakThresholdPct);
  const cls = (strike: number, side: 'CE' | 'PE', metric: 'volume' | 'oi') => { const m = marks[`${strike}|${side}|${metric}`]; return m ? MARK_CLASS[m] : ''; };
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[760px] text-xs tabular-nums">
        <thead className="bg-muted/50 text-[11px] text-muted-foreground">
          <tr>
            <th colSpan={4} className="px-2 py-1.5 text-center">Calls (CE)</th>
            <th className="px-2 py-1.5"><span className="sr-only">Strike</span></th>
            <th colSpan={4} className="px-2 py-1.5 text-center">Puts (PE)</th>
          </tr>
          <tr>
            <th className="px-2 py-1 text-right">Reversal (proxy: {methodLabel})</th><th className="px-2 py-1 text-right">LTP</th><th className="px-2 py-1 text-right">OI</th><th className="px-2 py-1 text-right">Volume</th>
            <th className="px-2 py-1 text-center">Strike</th>
            <th className="px-2 py-1 text-right">Volume</th><th className="px-2 py-1 text-right">OI</th><th className="px-2 py-1 text-right">LTP</th><th className="px-2 py-1 text-right">Reversal (proxy: {methodLabel})</th>
          </tr>
        </thead>
        <tbody>
          {chain.map((r) => (
            <tr key={r.strike} className={`border-t border-border ${r.mark ? 'border-t-2 border-t-blue-500' : ''}`}>
              <td className="px-2 py-1 text-right text-muted-foreground">{num(r.callReversal)}</td>
              <td className="px-2 py-1 text-right">{num(r.ce?.ltp)}</td>
              <td className={`px-2 py-1 text-right ${cls(r.strike, 'CE', 'oi')}`}>{compact(r.ce?.oi)}</td>
              <td className={`px-2 py-1 text-right ${cls(r.strike, 'CE', 'volume')}`}>{compact(r.ce?.volume)}</td>
              <td className="px-2 py-1 text-center font-semibold">
                {r.strike}
                {r.mark ? <span className="ml-1 rounded bg-blue-500/15 px-1 text-[10px] font-normal text-blue-700 dark:text-blue-300">{r.mark === 'line_high' ? 'line ▲' : r.mark === 'line_low' ? 'line ▼' : 'line'}</span> : null}
                {r.role ? <span className={`ml-1 rounded px-1 text-[10px] font-normal ${r.role === 'support' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>{r.role === 'support' ? 'support' : 'resistance'}</span> : null}
              </td>
              <td className={`px-2 py-1 text-right ${cls(r.strike, 'PE', 'volume')}`}>{compact(r.pe?.volume)}</td>
              <td className={`px-2 py-1 text-right ${cls(r.strike, 'PE', 'oi')}`}>{compact(r.pe?.oi)}</td>
              <td className="px-2 py-1 text-right">{num(r.pe?.ltp)}</td>
              <td className="px-2 py-1 text-right text-muted-foreground">{num(r.putReversal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Blue: highest value in the column among the strikes the engine searches (puts at or below the line, calls at or above it, within the rows shown). Yellow box: second-highest above {LTP_CONFIG.weakThresholdPct}% of the highest (weak). The line is marked in blue.
      </p>
    </div>
  );
}
