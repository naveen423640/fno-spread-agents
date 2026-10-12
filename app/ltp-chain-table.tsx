'use client';

import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { LTP_CONFIG } from '@/lib/ltp/config';
import type { SideStrength } from '@/lib/ltp/strength';
import type { ChainView } from '@/lib/ltp/state';
import { highlightCells, type CellMark } from '@/lib/ltp/view';

// Laid out like the real tool's detailed chain: calls on the left, the orange strike column, puts on the right. OI and volume are in lots,
// each with its share of the column highest underneath. Fixed colours on purpose (the tool has its own look).
const lots = (v: number | null | undefined, lot: number) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(v / lot)));
const dec = (v: number | null | undefined) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v));
const signed = (v: number) => `${v > 0 ? '+' : ''}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v)}`;
const BODY = '#dfe3e6';

const MARK: Record<CellMark, { background: string; fontWeight: number }> = {
  max: { background: '#a9d8f2', fontWeight: 700 },
  second_weak: { background: '#fde047', fontWeight: 700 },
};

function Badge({ s, metric }: { s: SideStrength; metric: 'volume' | 'oi' }) {
  const m = s.byMetric[metric];
  if (m.pct === null) return <span className="text-[10px] text-slate-500">–</span>;
  return (
    <span className="inline-block rounded border-2 border-black bg-white px-1.5 py-0.5 text-[11px] font-bold text-black">
      {m.weak ? (m.direction === 'wtt' ? 'WTT' : 'WTB') : 'STRONG'} {m.pct.toFixed(2)} %
    </span>
  );
}

export function LtpChainTable({ chain, analysis, methodLabel, spot, underlying }: { chain: ChainView[]; analysis: UsableAnalysis; methodLabel: string; spot: number; underlying: string }) {
  const { line } = analysis.levels;
  const lot = LTP_CONFIG.lotSize[underlying] ?? 1;
  const marks = highlightCells(chain, line, LTP_CONFIG.weakThresholdPct);

  // Percent of the column highest among the strikes the engine searches (puts up to the line's upper strike, calls from its lower strike).
  const top = (side: 'CE' | 'PE', metric: 'volume' | 'oi' | 'oiChange') => {
    const vals = chain.filter((r) => (side === 'PE' ? r.strike <= line.high : r.strike >= line.low)).map((r) => Math.abs((side === 'PE' ? r.pe : r.ce)?.[metric] ?? 0));
    return Math.max(0, ...vals);
  };
  const tops = { CE: { volume: top('CE', 'volume'), oi: top('CE', 'oi'), oiChange: top('CE', 'oiChange') }, PE: { volume: top('PE', 'volume'), oi: top('PE', 'oi'), oiChange: top('PE', 'oiChange') } };

  const cell = (strike: number, side: 'CE' | 'PE', metric: 'volume' | 'oi', value: number | null | undefined) => {
    const m = marks[`${strike}|${side}|${metric}`];
    const pct = value !== null && value !== undefined && tops[side][metric] > 0 ? (value / tops[side][metric]) * 100 : null;
    return (
      <td className="px-2 py-1 text-center" style={{ background: m ? MARK[m].background : BODY, fontWeight: m ? MARK[m].fontWeight : 600 }}>
        <div>{lots(value, lot)}</div>
        {pct !== null ? <div className="text-[10px] font-semibold text-slate-700">{pct.toFixed(2)}%</div> : null}
      </td>
    );
  };
  const change = (strike: number, side: 'CE' | 'PE', value: number | null | undefined) => {
    const pct = value !== null && value !== undefined && tops[side].oiChange > 0 ? (value / tops[side].oiChange) * 100 : null;
    const best = value !== null && value !== undefined && value > 0 && Math.abs(value) === tops[side].oiChange;
    return (
      <td className="px-2 py-1 text-center text-[12px] font-semibold" style={{ background: best ? '#86efac' : BODY, color: !value ? '#475569' : value > 0 ? '#15803d' : '#dc2626' }}>
        <div>{value === null || value === undefined ? '–' : signed(Math.round(value / lot))}</div>
        {pct !== null ? <div className="text-[10px]">{pct.toFixed(2)}%</div> : null}
      </td>
    );
  };
  const reversal = (value: number | null, shown: boolean, word: string, ltp: number | null | undefined) => (
    <td className="bg-white px-2 py-1 text-center text-[12px] font-semibold text-slate-800" title={ltp === null || ltp === undefined ? undefined : `LTP ${dec(ltp)}`}>
      {shown ? dec(value) : <span className="text-slate-500">{word}</span>}
    </td>
  );

  // The red line between the two strikes of the pair, with the spot in the strike column and the strength badges under their own columns.
  const lineCell = (key: string, content: React.ReactNode = null) => (
    <td key={key} className="relative px-1 py-2 text-center" style={{ background: BODY }}>
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-red-600" />
      <div className="relative z-10">{content}</div>
    </td>
  );
  const lineRow = (
    <tr key="line">
      {lineCell('a')}
      {lineCell('b', <Badge s={analysis.strength.resistance} metric="oi" />)}
      {lineCell('c', <Badge s={analysis.strength.resistance} metric="volume" />)}
      {lineCell('d')}
      <td className="relative bg-orange-500 px-2 py-1 text-center">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-red-600" />
        <div className="relative z-10 mx-auto w-fit rounded bg-orange-700 px-2 text-[9px] font-bold text-white">SPOT</div>
        <div className="relative z-10 mx-auto w-fit rounded bg-white px-2 text-sm font-extrabold text-black">{dec(spot)}</div>
      </td>
      {lineCell('e')}
      {lineCell('f', <Badge s={analysis.strength.support} metric="volume" />)}
      {lineCell('g', <Badge s={analysis.strength.support} metric="oi" />)}
      {lineCell('h')}
    </tr>
  );

  return (
    <div className="overflow-x-auto bg-white" style={{ colorScheme: 'light' }}>
      <table className="w-full min-w-[860px] border-collapse text-[13px] tabular-nums text-slate-900">
        <thead>
          <tr className="bg-slate-100 text-[11px] font-extrabold uppercase text-slate-800">
            <th className="px-2 py-1.5">OI Chg</th><th className="px-2 py-1.5">OI</th><th className="px-2 py-1.5">Volume</th>
            <th className="px-2 py-1.5" title={`Reversal (proxy: ${methodLabel})`}>S-Reversal*</th>
            <th className="bg-orange-500 px-3 py-1.5 text-white">ATM ⇅ Strike</th>
            <th className="px-2 py-1.5" title={`Reversal (proxy: ${methodLabel})`}>S-Reversal*</th><th className="px-2 py-1.5">Volume</th><th className="px-2 py-1.5">OI</th><th className="px-2 py-1.5">OI Chg</th>
          </tr>
        </thead>
        <tbody>
          {chain.flatMap((r) => {
            const row = (
              <tr key={r.strike} className="border-t border-white">
                {change(r.strike, 'CE', r.ce?.oiChange)}
                {cell(r.strike, 'CE', 'oi', r.ce?.oi)}
                {cell(r.strike, 'CE', 'volume', r.ce?.volume)}
                {reversal(r.callReversal, r.strike >= line.low, 'Break Out', r.ce?.ltp)}
                <td className="bg-orange-500 px-3 py-1 text-center text-[15px] font-extrabold text-white">
                  {r.strike.toFixed(1)}
                  {r.role ? <div className="text-[9px] font-bold uppercase tracking-wide">{r.role}</div> : null}
                </td>
                {reversal(r.putReversal, r.strike <= line.high, 'Break Down', r.pe?.ltp)}
                {cell(r.strike, 'PE', 'volume', r.pe?.volume)}
                {cell(r.strike, 'PE', 'oi', r.pe?.oi)}
                {change(r.strike, 'PE', r.pe?.oiChange)}
              </tr>
            );
            return r.mark === 'line' || r.mark === 'line_low' ? [row, lineRow] : [row];
          })}
        </tbody>
      </table>
      <p className="bg-slate-100 px-3 py-1.5 text-[11px] text-slate-700">
        OI and volume in lots of {lot}. Bold blue: highest in its column. <span className="rounded bg-yellow-300 px-1 font-bold">Yellow</span>: second-highest above {LTP_CONFIG.weakThresholdPct}% of the highest (weak). % is the share of the column highest. * Reversal is a proxy ({methodLabel}); hover for the LTP.
      </p>
    </div>
  );
}
