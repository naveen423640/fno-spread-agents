'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LoggedEvent, Reversal, UsableAnalysis } from '@/lib/ltp/analyze';
import { tradeMapping } from '@/lib/ltp/coa1';
import { istHhmm } from '@/lib/ltp/time';
import { tradeLevels, type TradeCell } from '@/lib/ltp/view';

// What opens when you click the banner, like the real tool: the scenario, then the support and resistance changes since the open with the
// spot and the EOR / EOS family at each change. The real tool also shows futures prices there; we do not record futures.
const ordinal = (n: number) => `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;
const num = (v: number | null | undefined) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v));
const clockSeconds = (ts: number) => `${istHhmm(ts)}`;

type Tab = 'scenario' | 'resistance' | 'support';

export function LtpScenarioDialog({ open, onOpenChange, analysis, name, nowLabel }: { open: boolean; onOpenChange: (open: boolean) => void; analysis: UsableAnalysis; name: string; nowLabel: string }) {
  const [tab, setTab] = useState<Tab>('resistance');
  const kind = analysis.direction.banner.kind;
  const sc = analysis.coa1.scenario;
  const t = tradeLevels(analysis);
  const show = (c: TradeCell, off: boolean) => (off ? 'NA' : c.broken ?? num(c.value));
  const side = tab === 'support' ? 'support' : 'resistance';
  const events: LoggedEvent[] = tab === 'scenario' ? [] : [...analysis.direction[side].events].reverse();
  const family = side === 'support' ? ['EOS', 'EOS +1', 'EOS -1'] : ['EOR', 'EOR +1', 'EOR -1'];
  const reversal = (r: Reversal | undefined) => (r === undefined || r === null ? '–' : r === 'broken' ? (side === 'support' ? 'Break Down' : 'Break Out') : num(r));
  const tabClass = (id: Tab) => `px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-green-400 text-white' : 'text-slate-700'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[95vw] gap-3 overflow-y-auto bg-white p-5 text-slate-900 sm:max-w-5xl" style={{ colorScheme: 'light' }}>
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold">LTP Calculator – {name} {kind === 'mixed' ? 'SIDES DISAGREE' : `IS IN ${analysis.direction.banner.text.toUpperCase()}`}</DialogTitle>
          <DialogDescription className="sr-only">Support and resistance changes since the open</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
          <div className="flex">
            <button type="button" className={tabClass('scenario')} onClick={() => setTab('scenario')}>{ordinal(sc.number)} SCENARIO</button>
            <button type="button" className={tabClass('resistance')} onClick={() => setTab('resistance')}>RESISTANCE</button>
            <button type="button" className={tabClass('support')} onClick={() => setTab('support')}>SUPPORT</button>
          </div>
          <span className="text-base font-semibold">Today {nowLabel}</span>
        </div>
        <div className="grid overflow-hidden rounded-xl text-center text-sm font-bold text-white sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-red-600 px-4 py-3 text-left sm:text-center">
            <span>Risky Resistance : {show(t.short.risky, t.ruledOut.short)}</span><span>Moderate Resistance : {show(t.short.moderate, t.ruledOut.short)}</span>
            <span>Max Pain : {show(t.short.maxPain, t.ruledOut.short)}</span><span>Max Gain : {show(t.short.maxGain, t.ruledOut.short)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-green-600 px-4 py-3 text-left sm:text-center">
            <span>Risky Support : {show(t.long.risky, t.ruledOut.long)}</span><span>Moderate Support : {show(t.long.moderate, t.ruledOut.long)}</span>
            <span>Max Pain : {show(t.long.maxPain, t.ruledOut.long)}</span><span>Max Gain : {show(t.long.maxGain, t.ruledOut.long)}</span>
          </div>
        </div>

        {tab === 'scenario' ? (
          <div className="grid gap-2 text-sm">
            <p><strong>Scenario {sc.number}: {sc.bias}</strong>{sc.tradable ? '' : ' · not tradable'}</p>
            <p>Resistance is {analysis.direction.resistance.current}, support is {analysis.direction.support.current} (from each side&apos;s latest change). Allowed: {sc.allowed.join(', ') || 'none'}.</p>
            <p>Top reversal: {sc.top ?? 'N/A'} · Bottom reversal: {sc.bottom ?? 'N/A'}.</p>
            <p>At the bottom: {tradeMapping('bottom').join(', ')}. At the top: {tradeMapping('top').join(', ')}.</p>
            <p className="text-xs text-slate-500">All reversal values are proxies ({analysis.method.label}).</p>
          </div>
        ) : (
          <div className="max-h-[46vh] overflow-auto rounded border border-slate-300">
            <table className="w-full border-collapse text-center text-sm text-slate-900">
              <thead className="sticky top-0 bg-slate-800 text-white">
                <tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Spot price</th><th className="px-3 py-3">Spot Reversal*</th><th className="px-2 py-3 capitalize">{side}</th><th className="px-2 py-3">Shifted</th><th className="px-2 py-3">Direction</th></tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-t border-slate-300" style={{ background: i === 0 ? '#8ab4f8' : '#ffffff' }}>
                    <td className="px-2 py-2 font-semibold">{clockSeconds(e.ts)}</td>
                    <td className="px-2 py-2">{num(e.spot)}</td>
                    <td className="px-2 py-2">{family.map((label, k) => <div key={label}>{label}: {reversal(k === 0 ? e.reversals?.center : k === 1 ? e.reversals?.plus1 : e.reversals?.minus1)}</div>)}</td>
                    <td className="px-2 py-2 font-semibold">{e.label}</td>
                    <td className="px-2 py-2 font-semibold">{e.text}</td>
                    <td className="px-2 py-2 font-semibold capitalize">{e.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length ? <p className="p-4 text-sm text-slate-500">No changes recorded yet.</p> : null}
            <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">* proxy ({analysis.method.label}). Only changes seen since our recorder started are listed; the real tool lists them from 09:15. Futures columns are not shown because futures are not recorded.</p>
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={() => onOpenChange(false)} className="rounded bg-blue-600 px-6 py-2 text-sm font-bold uppercase text-white hover:bg-blue-700">Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
