'use client';

import { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Link2, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CheckFailure, CheckSuccess, DetailFailure, DetailSuccess } from '@/lib/screener/service';
import type { ScanRow } from '@/lib/screener/types';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const price = (n: number | null) => (n === null ? 'n/a' : n.toFixed(2));
const SMA_COLORS = { sma20: '#2563eb', sma50: '#d97706', sma200: '#7c3aed' } as const;
const INPUT = 'h-9 w-28 rounded-lg border border-border bg-background px-2 text-right text-sm tabular-nums';

type Check = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; data: CheckSuccess } | { state: 'error'; failure: CheckFailure };
type Detail = { state: 'loading' } | { state: 'ok'; data: DetailSuccess } | { state: 'error'; failure: DetailFailure };

export function CandidateDrawer({ row, source, asOf, liveLabel, onClose }: { row: ScanRow; source: string; asOf: string; liveLabel: string; onClose: () => void }) {
  const bull = row.side === 'BULL CALL';
  const [kLong, setKLong] = useState(String(row.longStrikeApprox));
  const [kShort, setKShort] = useState(String(row.shortStrikeApprox));
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [detail, setDetail] = useState<Detail>({ state: 'loading' });

  const query = useCallback((extra: Record<string, string> = {}) => new URLSearchParams({ source, symbol: row.symbol, side: bull ? 'bull' : 'bear', kLong, kShort, expiry: row.expiry, ...extra }).toString(), [source, row.symbol, row.expiry, bull, kLong, kShort]);

  const loadDetail = useCallback(async (extra: Record<string, string> = {}) => {
    try {
      const response = await fetch(`/api/screener/candles?${query(extra)}`, { cache: 'no-store' });
      const body = (await response.json()) as DetailSuccess | DetailFailure;
      setDetail(body.ok ? { state: 'ok', data: body } : { state: 'error', failure: body });
    } catch {
      setDetail({ state: 'error', failure: { ok: false, code: 'NO_DATA', message: 'Could not load the chart.' } });
    }
  }, [query]);

  // Load the chart once when the drawer opens (the drawer is remounted per candidate); later loads are explicit.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ source, symbol: row.symbol, side: row.side === 'BULL CALL' ? 'bull' : 'bear', kLong: String(row.longStrikeApprox), kShort: String(row.shortStrikeApprox), expiry: row.expiry });
    if (row.lotSize) params.set('lot', String(row.lotSize));
    fetch(`/api/screener/candles?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json() as Promise<DetailSuccess | DetailFailure>)
      .then((body) => { if (!cancelled) setDetail(body.ok ? { state: 'ok', data: body } : { state: 'error', failure: body }); })
      .catch(() => { if (!cancelled) setDetail({ state: 'error', failure: { ok: false, code: 'NO_DATA', message: 'Could not load the chart.' } }); });
    return () => { cancelled = true; };
  }, [source, row]);

  const runCheck = async () => {
    setCheck({ state: 'loading' });
    try {
      const response = await fetch(`/api/screener/check?${query()}`, { cache: 'no-store' });
      const body = (await response.json()) as CheckSuccess | CheckFailure;
      if (!body.ok) { setCheck({ state: 'error', failure: body }); return; }
      setCheck({ state: 'ok', data: body });
      await loadDetail({ debit: String(body.check.debit), lot: String(body.lot) });
    } catch {
      setCheck({ state: 'error', failure: { ok: false, code: 'UPSTREAM', message: 'The check could not reach the server.' } });
    }
  };

  const chart = detail.state === 'ok' ? detail.data : null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100dvw-1.5rem)] max-w-5xl gap-4 overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{row.symbol} <span className="text-sm font-normal text-muted-foreground">{row.sector} · {bull ? 'Bull call spread' : 'Bear put spread'} · {row.status}</span></DialogTitle>
          <DialogDescription>Close {row.close.toFixed(1)} · RSI {row.rsi.toFixed(1)} · RS vs Nifty {row.rs63Pct > 0 ? '+' : ''}{row.rs63Pct.toFixed(1)}% · expiry {row.expiry} · lot {row.lotSize ?? 'n/a'} · data as of {asOf}</DialogDescription>
        </DialogHeader>

        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Check earnings and news dates manually before trading this name. The screen cannot see them.</p>

        <section aria-label="Price chart" className="space-y-2">
          {detail.state === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading the chart…</p>}
          {detail.state === 'error' && <p role="alert" className="rounded-xl border border-border p-3 text-sm text-muted-foreground">{detail.failure.message}</p>}
          {chart && (
            <>
              <figure className="h-64 w-full" aria-label={`Price with 20, 50 and 200 day averages for ${row.symbol}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={40} tick={{ fontSize: 11 }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={52} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="close" name="Close" stroke="#0f172a" dot={false} strokeWidth={1.8} isAnimationActive={false} />
                    <Line type="monotone" dataKey="sma20" name="SMA 20" stroke={SMA_COLORS.sma20} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="sma50" name="SMA 50" stroke={SMA_COLORS.sma50} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="sma200" name="SMA 200" stroke={SMA_COLORS.sma200} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                    {chart.levels.resistance.map((level) => <ReferenceLine key={`r${level}`} y={level} stroke="#b42318" strokeDasharray="4 4" label={{ value: `R ${level.toFixed(0)}`, position: 'insideTopRight', fontSize: 10, fill: '#b42318' }} />)}
                    {chart.levels.support.map((level) => <ReferenceLine key={`s${level}`} y={level} stroke="#1a7f4b" strokeDasharray="4 4" label={{ value: `S ${level.toFixed(0)}`, position: 'insideBottomRight', fontSize: 10, fill: '#1a7f4b' }} />)}
                  </LineChart>
                </ResponsiveContainer>
              </figure>
              <figure className="h-28 w-full" aria-label={`RSI 14 for ${row.symbol}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart.series} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fontSize: 11 }} width={52} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={30} stroke="#94a3b8" strokeDasharray="3 3" />
                    <ReferenceLine y={70} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="rsi" name="RSI 14" stroke="#0f766e" dot={false} strokeWidth={1.4} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </figure>
              <p className="text-xs text-muted-foreground">Support and resistance are the nearest swing pivots of the last 120 sessions (a drawing aid, not an entry rule). Dashed green is support, dashed red is resistance.</p>
            </>
          )}
        </section>

        <section aria-label="Live option check" className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">Long strike ({bull ? 'call' : 'put'})<input className={INPUT} inputMode="decimal" value={kLong} onChange={(e) => setKLong(e.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Short strike ({bull ? 'call' : 'put'})<input className={INPUT} inputMode="decimal" value={kShort} onChange={(e) => setKShort(e.target.value)} /></label>
            <Button onClick={() => void runCheck()} disabled={check.state === 'loading'}>{check.state === 'loading' ? <Loader2 className="animate-spin" /> : <RefreshCw />}Check live quotes</Button>
            <p className="pb-2 text-xs text-muted-foreground">Source: {liveLabel}. Read-only: it only reads quotes.</p>
          </div>

          {check.state === 'error' && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <span>{check.failure.message}</span>
              {check.failure.code === 'LOGIN_REQUIRED' && <Button size="sm" variant="outline" onClick={() => window.location.assign('/api/fyers/login')}><Link2 />Connect FYERS</Button>}
            </div>
          )}

          {check.state === 'ok' && (
            <div className="space-y-3 text-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left">
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3 font-medium">Leg</th><th className="py-1 pr-3 font-medium">Symbol</th><th className="py-1 pr-3 text-right font-medium">Bid</th><th className="py-1 pr-3 text-right font-medium">Ask</th><th className="py-1 text-right font-medium">OI</th></tr></thead>
                  <tbody>
                    {([['Buy (long)', check.data.longSymbol, check.data.check.long], ['Sell (short)', check.data.shortSymbol, check.data.check.short]] as const).map(([label, symbol, leg]) => (
                      <tr key={label} className="border-t border-border"><td className="py-1.5 pr-3">{label}</td><td className="py-1.5 pr-3 font-mono text-xs">{symbol}</td><td className="py-1.5 pr-3 text-right tabular-nums">{price(leg.bid)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{price(leg.ask)}</td><td className="py-1.5 text-right tabular-nums">{leg.oi === null ? 'n/a' : leg.oi.toLocaleString('en-IN')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Debit (buy ask − sell bid)</dt><dd className="tabular-nums">{check.data.check.debit.toFixed(2)} = {check.data.check.debitPctOfWidth.toFixed(0)}% of width {check.data.check.width}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Breakeven</dt><dd className="tabular-nums">{check.data.check.breakeven.toFixed(2)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Max loss per lot ({check.data.lot})</dt><dd className="tabular-nums text-red-700">{rupees(check.data.check.maxLossRs)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Max profit per lot</dt><dd className="tabular-nums text-emerald-700">{rupees(check.data.check.maxProfitRs)} ({check.data.check.rewardToRisk.toFixed(1)}× risk)</dd></div>
              </dl>
              {check.data.check.warnings.map((w) => <p key={w} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">WARN {w}</p>)}
              {check.data.check.notes.map((n) => <p key={n} className="rounded-lg border border-border bg-muted p-2 text-muted-foreground">NOTE {n}</p>)}
              <p className="text-xs text-muted-foreground">Lot size comes from the broker. Margin for a same-expiry debit spread should be close to the net debit: confirm with your broker before trading.</p>
            </div>
          )}
        </section>

        {chart && (
          <section aria-label="Action plan" className="space-y-3 rounded-xl border border-border p-4 text-sm">
            <h3 className="font-semibold">Action plan <span className="text-xs font-normal text-muted-foreground">(based on {chart.planBasis === 'live quote' ? 'the live quote debit' : 'a modelled debit; run the live check for a real one'})</span></h3>
            {!chart.plan ? <p className="text-muted-foreground">{chart.planNote}</p> : (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Profit target ({chart.plan.profitTarget.pctOfMaxProfit.toFixed(0)}% of max profit)</dt><dd>Spread worth <b className="tabular-nums">{chart.plan.profitTarget.spreadValue.toFixed(2)}</b> (about {rupees(chart.plan.profitTarget.profitRsPerLot)} per lot)</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Premium stop</dt><dd>Spread worth <b className="tabular-nums">{chart.plan.premiumStop.spreadValue.toFixed(2)}</b> or less (about {rupees(chart.plan.premiumStop.lossRsPerLot)} lost per lot)</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Price stop (trend invalidation)</dt><dd>A close {chart.plan.priceStop.direction}: {chart.plan.priceStop.levels.map((l) => `${l.label} ${l.value.toFixed(1)}`).join(' or ')}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Time stop</dt><dd>{chart.plan.timeStop.note}</dd></div>
                </dl>
                <p><b>Trail:</b> {chart.plan.trail}</p>
                <div><b>Gap-open rules</b><ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{chart.plan.gapRules.map((r) => <li key={r}>{r}</li>)}</ul></div>
                <div><b>Exit order</b><ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">{chart.plan.exitOrder.map((r) => <li key={r}>{r}</li>)}</ol></div>
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">{chart.plan.manualChecks.join(' ')}</p>
              </>
            )}
          </section>
        )}
        <p className="text-xs text-muted-foreground">Analysis, not advice. This tab never places, changes or cancels an order.</p>
      </DialogContent>
    </Dialog>
  );
}
