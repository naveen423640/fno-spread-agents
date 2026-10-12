'use client';

import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { LTP_CONFIG } from '@/lib/ltp/config';
import type { SideStrength } from '@/lib/ltp/strength';
import type { ChainView } from '@/lib/ltp/state';
import { columnPercents, highlightCells, type CellMark } from '@/lib/ltp/view';

const int = (v: number | null | undefined) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v));
const dec = (v: number | null | undefined) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v));
const signedInt = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${int(v)}`);

// Highest of a column: bold. Second-highest above 75% of it (weak): yellow, like the original screen.
const MARK_CLASS: Record<CellMark, string> = {
  max: 'bg-sky-500/20 font-bold',
  second_weak: 'bg-yellow-300 font-bold text-black',
};

// The badge under the volume and OI columns on the line row: "WTT 77.2%" when weak, "STRONG 59.6%" otherwise.
function Badge({ s, metric }: { s: SideStrength; metric: 'volume' | 'oi' }) {
  const m = s.byMetric[metric];
  if (m.pct === null) return <span className="text-muted-foreground">–</span>;
  const weak = m.weak;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${weak ? 'bg-yellow-300 text-black' : 'bg-emerald-600 text-white'}`}>
      {weak ? (m.direction === 'wtt' ? 'WTT' : 'WTB') : 'STRONG'} {m.pct.toFixed(2)}%
    </span>
  );
}

export function LtpChainTable({ chain, analysis, methodLabel, spot }: { chain: ChainView[]; analysis: UsableAnalysis; methodLabel: string; spot: number }) {
  const { line } = analysis.levels;
  const marks = highlightCells(chain, line, LTP_CONFIG.weakThresholdPct);
  const pcts = columnPercents(chain, line);
  const cell = (strike: number, side: 'CE' | 'PE', metric: 'volume' | 'oi', value: number | null | undefined) => {
    const key = `${strike}|${side}|${metric}`;
    const m = marks[key];
    return (
      <td className={`px-2 py-1 text-right ${m ? MARK_CLASS[m] : ''}`}>
        <div>{int(value)}</div>
        {pcts[key] !== undefined ? <div className={`text-[10px] ${m === 'second_weak' ? 'text-black/70' : 'text-muted-foreground'}`}>{pcts[key].toFixed(2)}%</div> : null}
      </td>
    );
  };
  const change = (v: number | null | undefined) => <td className={`px-2 py-1 text-right text-[11px] ${v ? (v > 0 ? 'text-emerald-600' : 'text-red-600') : 'text-muted-foreground'}`}>{signedInt(v)}</td>;
  const lineRow = (
    <tr key="line" className="border-y-2 border-blue-500 bg-blue-500/5">
      <td colSpan={2} className="px-2 py-1.5 text-right text-[11px] text-muted-foreground">Resistance strength</td>
      <td className="px-2 py-1.5 text-right"><Badge s={analysis.strength.resistance} metric="volume" /></td>
      <td className="px-2 py-1.5 text-right"><Badge s={analysis.strength.resistance} metric="oi" /></td>
      <td className="px-2 py-1.5"><span className="sr-only">gap</span></td>
      <td className="px-2 py-1.5 text-center"><span className="rounded bg-foreground px-2 py-0.5 text-xs font-bold text-background">{dec(spot)}</span><div className="text-[9px] text-muted-foreground">SPOT</div></td>
      <td className="px-2 py-1.5"><span className="sr-only">gap</span></td>
      <td className="px-2 py-1.5 text-left"><Badge s={analysis.strength.support} metric="volume" /></td>
      <td className="px-2 py-1.5 text-left"><Badge s={analysis.strength.support} metric="oi" /></td>
      <td colSpan={2} className="px-2 py-1.5 text-left text-[11px] text-muted-foreground">Support strength</td>
    </tr>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[900px] text-xs tabular-nums">
        <thead className="text-[11px]">
          <tr className="bg-muted/60 text-muted-foreground">
            <th colSpan={5} className="px-2 py-1 text-center text-red-600">CALL SIDE (resistance)</th>
            <th className="bg-orange-500 px-2 py-1 text-white">ATM STRIKE</th>
            <th colSpan={5} className="px-2 py-1 text-center text-emerald-600">PUT SIDE (support)</th>
          </tr>
          <tr className="bg-muted/30 text-muted-foreground">
            <th className="px-2 py-1 text-right">OI Chg</th><th className="px-2 py-1 text-right">OI</th><th className="px-2 py-1 text-right">Volume</th>
            <th className="px-2 py-1 text-right" title={`Reversal (proxy: ${methodLabel})`}>Rev*</th><th className="px-2 py-1 text-right">LTP</th>
            <th className="bg-orange-500/90 px-2 py-1 text-white">Strike</th>
            <th className="px-2 py-1 text-left">LTP</th><th className="px-2 py-1 text-left" title={`Reversal (proxy: ${methodLabel})`}>Rev*</th>
            <th className="px-2 py-1 text-right">Volume</th><th className="px-2 py-1 text-right">OI</th><th className="px-2 py-1 text-right">OI Chg</th>
          </tr>
        </thead>
        <tbody>
          {chain.flatMap((r) => {
            const row = (
              <tr key={r.strike} className="border-t border-border">
                {change(r.ce?.oiChange)}
                {cell(r.strike, 'CE', 'oi', r.ce?.oi)}
                {cell(r.strike, 'CE', 'volume', r.ce?.volume)}
                <td className="px-2 py-1 text-right text-muted-foreground">{dec(r.callReversal)}</td>
                <td className="px-2 py-1 text-right font-medium">{dec(r.ce?.ltp)}</td>
                <td className="bg-orange-500 px-2 py-1 text-center text-sm font-bold text-white">
                  {r.strike}
                  {r.role ? <div className="text-[9px] font-semibold uppercase opacity-90">{r.role}</div> : null}
                </td>
                <td className="px-2 py-1 text-left font-medium">{dec(r.pe?.ltp)}</td>
                <td className="px-2 py-1 text-left text-muted-foreground">{dec(r.putReversal)}</td>
                {cell(r.strike, 'PE', 'volume', r.pe?.volume)}
                {cell(r.strike, 'PE', 'oi', r.pe?.oi)}
                {change(r.pe?.oiChange)}
              </tr>
            );
            return r.mark === 'line' || r.mark === 'line_low' ? [row, lineRow] : [row];
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Bold: highest in its column. <span className="rounded bg-yellow-300 px-1 font-bold text-black">Yellow</span>: second-highest above {LTP_CONFIG.weakThresholdPct}% of the highest (weak). The % under a value is its share of the column highest. Only puts at or below the line and calls at or above it count. Rev* = reversal (proxy: {methodLabel}).
      </p>
    </div>
  );
}
