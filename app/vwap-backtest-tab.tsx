'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FlaskConical, Link2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { BacktestResult, StrategyResult } from '@/lib/vwap/backtest/run';

const EquityChart = lazy(() => import('@/app/vwap-equity-chart').then((m) => ({ default: m.EquityChart })));

type Trade = { strategy: string; ticker: string; sector: string; day: string; direction: 1 | -1; signalType: string; borderline: boolean; entryT: number; entryPrice: number; exitT: number; exitPrice: number; exitReason: string; holdMinutes: number; maePct: number; mfePct: number; qty: number; grossPnl: number; costs: number; netPnl: number; netPct: number; modelled: boolean };
type Payload = { result: BacktestResult | null; trades?: Trade[]; tradesTruncated?: boolean; at?: string };
type Period = 'all' | 'train' | 'holdout';
type SortKey = 'entryT' | 'ticker' | 'netPnl' | 'netPct' | 'holdMinutes';

const UNIVERSES: [string, string][] = [['nifty_it', 'Nifty IT (10)'], ['sector:Banks', 'F&O: Banks'], ['sector:Auto', 'F&O: Auto'], ['sector:Metals', 'F&O: Metals'], ['sector:Healthcare', 'F&O: Healthcare'], ['custom', 'Custom list…']];
const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : `${v >= 0 ? '+' : ''}${f(v, d)}`);
const ist = (t: number) => new Date((t + 19_800) * 1000).toISOString().slice(11, 16);
const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'text-emerald-600' : 'text-red-600');

const post = (body: object) => fetch('/api/vwap/backtest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-full border px-2.5 py-1 text-[11px] ${active ? 'border-foreground/40 bg-muted font-medium' : 'border-border text-muted-foreground'}`}>{children}</button>;
}
function Card({ label, value, hint, className = '' }: { label: string; value: string; hint?: string; className?: string }) {
  return <div className="rounded-lg border border-border bg-card p-3"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`text-base font-semibold tabular-nums ${className}`}>{value}</div>{hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}</div>;
}

export function VwapBacktestTab() {
  const [universe, setUniverse] = useState('nifty_it');
  const [custom, setCustom] = useState('TCS, INFY, LTM');
  const [from, setFrom] = useState('2026-08-01');
  const [to, setTo] = useState('2026-10-09');
  const [instrument, setInstrument] = useState<'futures' | 'option'>('futures');
  const [source, setSource] = useState<'cache' | 'fyers'>('cache');
  const [slippage, setSlippage] = useState('2');
  const [firstOnly, setFirstOnly] = useState(false);
  const [skipBorderline, setSkipBorderline] = useState(false);
  const [entryTo, setEntryTo] = useState('15:00');
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<'load' | 'run' | null>(null);
  const [message, setMessage] = useState('');
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [strategyName, setStrategyName] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [slice, setSlice] = useState('direction');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'entryT', dir: 1 });
  const [rowsShown, setRowsShown] = useState(100);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/vwap/backtest', { cache: 'no-store' });
        if (response.ok) { const body = (await response.json()) as Payload; if (body.result) { setData(body); setStrategyName(body.result.strategies[0]?.name ?? ''); } }
      } catch { /* nothing stored yet */ }
    })();
  }, []);

  const config = useMemo(() => ({
    universe: universe === 'custom' ? `custom:${custom}` : universe, from, to, instrument, source, slippageBps: Number(slippage) || 0,
    filters: { firstCrossOnly: firstOnly, skipBorderline, entryTo },
  }), [universe, custom, from, to, instrument, source, slippage, firstOnly, skipBorderline, entryTo]);

  // Fetches the months from FYERS into the cache, a few symbols per request, until done.
  const load = useCallback(async () => {
    setBusy('load'); setMessage(''); setLoginNeeded(false);
    try {
      for (let offset = 0; offset < 400; offset += 8) {
        const response = await post({ action: 'load', config, offset });
        const body = (await response.json().catch(() => null)) as { loaded?: number; total?: number; done?: boolean; error?: string; loginRequired?: boolean; errors?: string[] } | null;
        if (response.status === 401 || body?.loginRequired) { setLoginNeeded(true); setMessage(body?.error ?? 'Connect FYERS to load data.'); break; }
        if (!response.ok || !body) { setMessage(body?.error ?? 'Loading failed.'); break; }
        setMessage(`Loaded ${body.loaded} of ${body.total} symbols${body.errors?.length ? ` (${body.errors[0]})` : ''}…`);
        if (body.done) { setMessage(`Loaded ${body.total} symbols. Press Run backtest.`); break; }
      }
    } catch { setMessage('Could not reach the server.'); } finally { setBusy(null); }
  }, [config]);

  const run = useCallback(async () => {
    setBusy('run'); setMessage('Replaying sessions…'); setRowsShown(100);
    try {
      const response = await post({ action: 'run', config });
      const body = (await response.json().catch(() => null)) as (Payload & { error?: string }) | null;
      if (!response.ok || !body?.result) { setMessage(body?.error ?? 'The backtest failed.'); return; }
      setData(body); setStrategyName(body.result.strategies[0]?.name ?? ''); setMessage('');
    } catch { setMessage('Could not reach the server.'); } finally { setBusy(null); }
  }, [config]);

  const result = data?.result ?? null;
  const strategy: StrategyResult | null = result ? result.strategies.find((s) => s.name === strategyName) ?? result.strategies[0] : null;
  const isOption = result?.config.instrument === 'option';
  const summary = strategy ? (period === 'all' ? strategy.all : period === 'train' ? strategy.train : strategy.holdout) : null;
  const holdoutMonths = result?.range.holdoutMonths;
  const periodTrades = useMemo(() => {
    const hold = data?.result?.range.holdoutMonths ?? [];
    const all = (data?.trades ?? []).filter((t) => t.strategy === (strategy?.name ?? ''));
    return period === 'all' ? all : all.filter((t) => (period === 'holdout') === hold.includes(t.day.slice(0, 7)));
  }, [data, strategy?.name, period]);
  const equity = useMemo(() => {
    const ordered = [...periodTrades].sort((a, b) => a.exitT - b.exitT);
    const out: { t: number; equity: number }[] = [];
    let running = 0;
    for (const t of ordered) { running += t.netPnl; out.push({ t: t.exitT, equity: running }); }
    return out;
  }, [periodTrades]);
  const sorted = useMemo(() => [...periodTrades].sort((a, b) => { const x = a[sort.key], y = b[sort.key]; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; }), [periodTrades, sort]);

  const exportCsv = () => {
    const header = 'strategy,symbol,sector,day,direction,signal,borderline,entry,entry_price,exit,exit_price,reason,hold_min,qty,gross,costs,net,net_pct,modelled';
    const lines = periodTrades.map((t) => [t.strategy, t.ticker, `"${t.sector}"`, t.day, t.direction === 1 ? 'long' : 'short', t.signalType, t.borderline, ist(t.entryT), t.entryPrice, ist(t.exitT), t.exitPrice, t.exitReason, t.holdMinutes, t.qty, t.grossPnl.toFixed(2), t.costs.toFixed(2), t.netPnl.toFixed(2), t.netPct.toFixed(4), t.modelled].join(','));
    const url = URL.createObjectURL(new Blob([`${header}\n${lines.join('\n')}\n`], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `vwap-backtest-${strategy?.name ?? 'trades'}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const th = (key: SortKey, label: string) => <th className="px-2 py-1.5 font-medium"><button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>{label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>;
  const unit = isOption ? 'Rs/trade' : '%/trade';
  const metricOf = (s: { meanNetPct: number | null; meanNetPnl: number | null }) => (isOption ? s.meanNetPnl : s.meanNetPct);
  const stratMetric = strategy ? (isOption ? strategy.all.expectancyRs : strategy.all.expectancyPct) : null;

  const bars = strategy && result ? [
    { label: `${strategy.name} (this strategy)`, value: stratMetric },
    { label: 'Random entries, median', value: strategy.random?.median ?? null },
    { label: 'Buy 09:30 → close', value: metricOf(result.baselines.openToClose.all.long) },
    { label: 'Sell 09:30 → close', value: metricOf(result.baselines.openToClose.all.short) },
    { label: 'Top gainers bought / losers sold', value: metricOf(result.baselines.gainersLosers.all) },
  ] : [];
  const barMax = Math.max(0.0001, ...bars.map((b) => Math.abs(b.value ?? 0)));

  return (
    <div className="mx-auto grid max-w-5xl gap-4 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><FlaskConical className="size-5" />VWAP crossover backtest</h1>
        <p className="text-xs text-muted-foreground">Replays monthly anchored VWAP crossovers candle by candle (no look-ahead) with the same detection as the live scanner, then compares five exit rules with random entries and simple baselines. Read-only.</p>
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-4">
        <label className="grid gap-1">Universe<select className="rounded-md border border-input bg-background px-2 py-1.5" value={universe} onChange={(e) => setUniverse(e.target.value)}>{UNIVERSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="grid gap-1">From<input type="date" className="rounded-md border border-input bg-background px-2 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grid gap-1">To<input type="date" className="rounded-md border border-input bg-background px-2 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="grid gap-1">Instrument<select className="rounded-md border border-input bg-background px-2 py-1.5" value={instrument} onChange={(e) => setInstrument(e.target.value as 'futures' | 'option')}><option value="futures">Futures proxy (spot × lot)</option><option value="option">1-strike OTM option (modelled)</option></select></label>
        {universe === 'custom' ? <label className="grid gap-1 sm:col-span-4">Tickers<input className="rounded-md border border-input bg-background px-2 py-1.5" value={custom} onChange={(e) => setCustom(e.target.value)} /></label> : null}
        <label className="grid gap-1">Data<select className="rounded-md border border-input bg-background px-2 py-1.5" value={source} onChange={(e) => setSource(e.target.value as 'cache' | 'fyers')}><option value="cache">Cached board history (offline)</option><option value="fyers">FYERS (load first)</option></select></label>
        <label className="grid gap-1">Slippage (bps per side)<input type="number" min="0" className="rounded-md border border-input bg-background px-2 py-1.5" value={slippage} onChange={(e) => setSlippage(e.target.value)} /></label>
        <label className="grid gap-1">Latest entry time<input type="time" className="rounded-md border border-input bg-background px-2 py-1.5" value={entryTo} onChange={(e) => setEntryTo(e.target.value)} /></label>
        <div className="flex flex-wrap items-end gap-3"><label className="flex items-center gap-1.5"><input type="checkbox" checked={firstOnly} onChange={(e) => setFirstOnly(e.target.checked)} />First cross of the day only</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={skipBorderline} onChange={(e) => setSkipBorderline(e.target.checked)} />Skip borderline</label></div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
          {source === 'fyers' ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void load()}><Download className={busy === 'load' ? 'animate-pulse' : ''} />{busy === 'load' ? 'Loading…' : 'Load data from FYERS'}</Button> : null}
          <Button size="sm" disabled={busy !== null} onClick={() => void run()}><Play />{busy === 'run' ? 'Running…' : 'Run backtest'}</Button>
          {loginNeeded ? <Button size="sm" variant="outline" onClick={() => { window.location.href = '/api/fyers/login'; }}><Link2 />Connect FYERS</Button> : null}
          <span className="text-muted-foreground">Up to 60 symbols here; use <code>npm run vwap:backtest</code> for bigger universes and the parameter grid.</span>
        </div>
        {message ? <div className="text-amber-700 sm:col-span-4 dark:text-amber-400">{message}</div> : null}
      </div>

      {result && strategy ? (
        <>
          <ul className="grid gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px]">{result.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>
          <div className="text-xs text-muted-foreground">{result.range.sessions} sessions · {result.range.months.join(', ')} · {result.symbols} symbols · hold-out: {holdoutMonths?.join(', ') || 'none'}{result.skipped.length ? ` · ${result.skipped.length} symbol-month(s) skipped` : ''}{isOption ? ' · option P&L is MODELLED' : ''}</div>

          <div className="flex flex-wrap items-center gap-1.5">
            {result.strategies.map((s) => <Chip key={s.name} active={s.name === strategy.name} onClick={() => setStrategyName(s.name)}>{s.name}</Chip>)}
            <span className="mx-1 h-4 w-px bg-border" />
            {(['all', 'train', 'holdout'] as const).map((p) => <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>{p === 'all' ? 'All months' : p === 'train' ? 'Training' : 'Hold-out'}</Chip>)}
          </div>

          {summary ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              <Card label="Trades" value={String(summary.trades)} hint={summary.trades < 100 ? 'thin sample' : undefined} />
              <Card label="Win rate" value={summary.winRate === null ? '–' : `${(summary.winRate * 100).toFixed(0)}%`} />
              <Card label="Expectancy / trade" value={`${sgn(summary.expectancyPct, 3)}%`} hint={`Rs ${sgn(summary.expectancyRs, 0)} · after costs`} className={tone(summary.expectancyPct)} />
              <Card label="Profit factor" value={f(summary.profitFactor)} />
              <Card label="Total net P&L" value={`Rs ${sgn(summary.totalPnl, 0)}`} hint={`costs Rs ${f(summary.totalCosts, 0)}`} className={tone(summary.totalPnl)} />
              <Card label="Max drawdown" value={`Rs ${f(summary.maxDrawdown, 0)}`} />
              <Card label="Daily Sharpe" value={f(summary.sharpeDaily)} hint="annualised" />
              <Card label="Avg hold" value={`${f(summary.avgHoldMinutes, 0)} min`} />
              <Card label="Avg MAE / MFE" value={`${sgn(summary.avgMaePct)}% / ${sgn(summary.avgMfePct)}%`} />
              <Card label="Gross P&L" value={`Rs ${sgn(summary.grossPnl, 0)}`} hint="before costs" />
            </div>
          ) : <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">There is no hold-out period for this range (it needs at least two months).</div>}

          <section className="grid gap-1"><h2 className="text-sm font-semibold">Equity curve</h2>{equity.length ? <Suspense fallback={<div className="h-[240px]" />}><EquityChart points={equity} /></Suspense> : <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">No trades in this view.</div>}<p className="text-[11px] text-muted-foreground">Cumulative net P&L in rupees, in the order trades closed.{data?.tradesTruncated ? ' The trade list was cut to the first 6,000 entries, so this curve is partial.' : ''}</p></section>

          <section className="grid gap-1">
            <h2 className="text-sm font-semibold">Strategy against baselines ({unit})</h2>
            <div className="grid gap-1.5 rounded-lg border border-border p-3 text-xs">
              {bars.map((b) => (
                <div key={b.label} className="grid grid-cols-[170px_1fr_70px] items-center gap-2 sm:grid-cols-[250px_1fr_80px]">
                  <span className="truncate text-muted-foreground">{b.label}</span>
                  <div className="relative h-3 rounded bg-muted"><div className="absolute inset-y-0 left-1/2 w-px bg-border" /><div className={`absolute inset-y-0 rounded ${(b.value ?? 0) >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ left: (b.value ?? 0) >= 0 ? '50%' : `${50 - (Math.abs(b.value ?? 0) / barMax) * 50}%`, width: `${(Math.abs(b.value ?? 0) / barMax) * 50}%` }} /></div>
                  <span className="text-right tabular-nums">{sgn(b.value, isOption ? 0 : 3)}</span>
                </div>
              ))}
              {strategy.random ? <p className="pt-1 text-[11px] text-muted-foreground">Random entries ({strategy.random.runs} runs, same times and counts per day, same exit): 5th to 95th percentile {sgn(strategy.random.p5, isOption ? 0 : 3)} to {sgn(strategy.random.p95, isOption ? 0 : 3)}. The strategy&apos;s chance of beating random by luck alone: p = {f(strategy.random.pValue, 3)}{strategy.random.holdoutPValue !== null ? ` (hold-out only: p = ${f(strategy.random.holdoutPValue, 3)})` : ''}. A bootstrap 95% interval for the mean net % per trade: {strategy.expectancyPctCI.all ? `${sgn(strategy.expectancyPctCI.all.low, 3)} to ${sgn(strategy.expectancyPctCI.all.high, 3)}` : '–'}.</p> : null}
            </div>
          </section>

          <section className="grid gap-1">
            <h2 className="text-sm font-semibold">All exit rules side by side</h2>
            <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr>{['Exit rule', 'Trades', 'Win %', 'Exp % (all)', 'Exp % (train)', 'Exp % (hold-out)', 'Hold-out trades', 'PF', 'Total Rs', 'p vs random'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{result.strategies.map((s) => <tr key={s.name} className={`cursor-pointer border-t border-border hover:bg-muted/40 ${s.name === strategy.name ? 'bg-muted/30' : ''}`} onClick={() => setStrategyName(s.name)}><td className="px-2 py-1.5 font-medium">{s.name}</td><td className="px-2 py-1.5 tabular-nums">{s.all.trades}</td><td className="px-2 py-1.5 tabular-nums">{s.all.winRate === null ? '–' : (s.all.winRate * 100).toFixed(0)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(s.all.expectancyPct)}`}>{sgn(s.all.expectancyPct, 3)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(s.train.expectancyPct)}`}>{sgn(s.train.expectancyPct, 3)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(s.holdout?.expectancyPct)}`}>{sgn(s.holdout?.expectancyPct, 3)}</td><td className="px-2 py-1.5 tabular-nums">{s.holdout?.trades ?? '–'}</td><td className="px-2 py-1.5 tabular-nums">{f(s.all.profitFactor)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(s.all.totalPnl)}`}>{f(s.all.totalPnl, 0)}</td><td className="px-2 py-1.5 tabular-nums">{f(s.random?.pValue, 3)}</td></tr>)}</tbody></table></div>
            <p className="text-[11px] text-muted-foreground">Training and hold-out sit side by side for every rule. A rule that looks good in training and not in the hold-out is overfitted or lucky. Five rules were tried, so the best of them is flattered.</p>
          </section>

          <section className="grid gap-1">
            <h2 className="text-sm font-semibold">When it works: entry time × day of month ({isOption ? 'mean net %' : 'mean net %'})</h2>
            {strategy.heatmap.rows.length ? (
              <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-center text-[11px]"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-2 py-1.5 text-left font-medium">Entry time</th>{strategy.heatmap.cols.map((c) => <th key={c} className="px-2 py-1.5 font-medium">Day {c}</th>)}</tr></thead>
                <tbody>{strategy.heatmap.rows.map((r) => <tr key={r} className="border-t border-border"><td className="px-2 py-1.5 text-left font-medium">{r}</td>{strategy.heatmap.cols.map((c) => { const cell = strategy.heatmap.cells[`${r}|${c}`]; const a = cell ? Math.min(0.6, Math.abs(cell.meanPct) / 1.5) : 0; return <td key={c} className="px-2 py-1.5 tabular-nums" style={cell ? { backgroundColor: cell.meanPct >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})` } : undefined} title={cell ? `${cell.n} trades` : ''}>{cell ? `${sgn(cell.meanPct, 2)} (${cell.n})` : ''}</td>; })}</tr>)}</tbody></table></div>
            ) : <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">No trades to show.</div>}
            <p className="text-[11px] text-muted-foreground">Cells show the mean net % per trade and the number of trades. The first days of a month are noisy because the monthly VWAP rests on only a few sessions; cells with few trades mean little.</p>
          </section>

          <section className="grid gap-1">
            <div className="flex flex-wrap items-center gap-1.5"><h2 className="mr-2 text-sm font-semibold">Slices</h2>{(['direction', 'signalType', 'borderline', 'timeOfDay', 'dayOfMonth', 'sector', 'symbol'] as const).map((s) => <Chip key={s} active={slice === s} onClick={() => setSlice(s)}>{s === 'signalType' ? 'signal type' : s === 'timeOfDay' ? 'time of day' : s === 'dayOfMonth' ? 'day of month' : s}</Chip>)}</div>
            <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr>{['', 'Trades', 'Win %', 'Exp % / trade', 'Exp Rs / trade', 'Total Rs'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{(strategy.slices[slice] ?? []).map((r) => <tr key={r.key} className="border-t border-border"><td className="px-2 py-1.5 font-medium">{r.key}</td><td className="px-2 py-1.5 tabular-nums">{r.trades}</td><td className="px-2 py-1.5 tabular-nums">{r.winRate === null ? '–' : (r.winRate * 100).toFixed(0)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(r.expectancyPct)}`}>{sgn(r.expectancyPct, 3)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(r.expectancyRs)}`}>{sgn(r.expectancyRs, 0)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(r.totalPnl)}`}>{f(r.totalPnl, 0)}</td></tr>)}</tbody></table></div>
            <p className="text-[11px] text-muted-foreground">Slicing makes small groups. Look at the trade counts before reading anything into a row.</p>
          </section>

          <section className="grid gap-1">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Trade log ({periodTrades.length})</h2><Button size="sm" variant="outline" disabled={!periodTrades.length} onClick={exportCsv}><Download />CSV</Button></div>
            <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr>{th('ticker', 'Symbol')}<th className="px-2 py-1.5 font-medium">Day</th>{th('entryT', 'Entry')}<th className="px-2 py-1.5 font-medium">Side</th><th className="px-2 py-1.5 font-medium">Signal</th><th className="px-2 py-1.5 font-medium">In</th><th className="px-2 py-1.5 font-medium">Out</th><th className="px-2 py-1.5 font-medium">Exit</th>{th('holdMinutes', 'Min')}{th('netPnl', 'Net Rs')}{th('netPct', 'Net %')}</tr></thead>
              <tbody>{sorted.slice(0, rowsShown).map((t, i) => <tr key={`${t.ticker}-${t.entryT}-${i}`} className="border-t border-border"><td className="px-2 py-1.5 font-medium">{t.ticker}</td><td className="px-2 py-1.5">{t.day.slice(5)}</td><td className="px-2 py-1.5">{ist(t.entryT)}</td><td className={`px-2 py-1.5 ${t.direction === 1 ? 'text-emerald-600' : 'text-red-600'}`}>{t.direction === 1 ? 'long' : 'short'}</td><td className="px-2 py-1.5">{t.signalType}{t.borderline ? ' ~' : ''}</td><td className="px-2 py-1.5 tabular-nums">{f(t.entryPrice)}</td><td className="px-2 py-1.5 tabular-nums">{f(t.exitPrice)}</td><td className="px-2 py-1.5">{t.exitReason}</td><td className="px-2 py-1.5 tabular-nums">{t.holdMinutes}</td><td className={`px-2 py-1.5 tabular-nums ${tone(t.netPnl)}`}>{sgn(t.netPnl, 0)}</td><td className={`px-2 py-1.5 tabular-nums ${tone(t.netPct)}`}>{sgn(t.netPct, 2)}</td></tr>)}</tbody></table></div>
            {rowsShown < sorted.length ? <Button size="sm" variant="outline" onClick={() => setRowsShown((n) => n + 200)}>Show more ({sorted.length - rowsShown} left)</Button> : null}
          </section>
        </>
      ) : <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-xs text-muted-foreground">No result yet. Choose a universe and press Run backtest. The offline cache covers about 100 days, so the first valid month is August.</div>}
    </div>
  );
}
