'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Link2, RefreshCw, Waves } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { marketSession } from '@/lib/market-session';
import { HOLIDAYS } from '@/lib/screener/holidays';
import type { CrossEvent } from '@/lib/vwap/core';
import type { VwapChartDay } from '@/app/vwap-chart';

const VwapChart = lazy(() => import('@/app/vwap-chart').then((m) => ({ default: m.VwapChart })));

type Row = {
  ticker: string; symbol: string; name: string; sector: string; status: 'ok' | 'no-session' | 'error'; error: string | null;
  vwap: number | null; lastClose: number | null; side: 'above' | 'below' | 'on' | null; distancePct: number | null; borderlineNow: boolean;
  crossesToday: number; events: CrossEvent[]; wickTouches: number; candlesUsed: number; formingExcluded: boolean; flags: string[];
  unreliable: boolean; unreliableNote: string; sessionsInMonth: number;
};
type SortKey = 'ticker' | 'sector' | 'distancePct' | 'crossesToday' | 'last';

const UNIVERSES: [string, string][] = [['nifty_it', 'Nifty IT (10)'], ['fo', 'F&O stocks (210)'], ['nifty500', 'Nifty 500'], ['sector:Banks', 'F&O: Banks'], ['sector:Financials', 'F&O: Financials'], ['sector:Auto', 'F&O: Auto'], ['sector:Metals', 'F&O: Metals'], ['sector:Healthcare', 'F&O: Healthcare'], ['custom', 'Custom list…']];
const SLICE = 40;
const num = (v: number | null, digits = 2) => (v === null ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const lastCross = (r: Row) => r.events[r.events.length - 1];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-full border px-2.5 py-1 text-[11px] ${active ? 'border-foreground/40 bg-muted font-medium' : 'border-border text-muted-foreground'}`}>{children}</button>;
}

export function VwapTab() {
  const [universe, setUniverse] = useState('nifty_it');
  const [custom, setCustom] = useState('TCS, INFY, LTM');
  const [date, setDate] = useState('');
  const [source, setSource] = useState<'fyers' | 'cache'>('fyers');
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanDay, setScanDay] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [direction, setDirection] = useState<'all' | 'up' | 'down'>('all');
  const [type, setType] = useState<'all' | 'close-cross' | 'body-cross' | 'gap-cross'>('all');
  const [borderlineOnly, setBorderlineOnly] = useState(false);
  const [sector, setSector] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'crossesToday', dir: -1 });
  const [selected, setSelected] = useState<Row | null>(null);
  const [chart, setChart] = useState<{ days: VwapChartDay[] } | null>(null);
  const [chartState, setChartState] = useState<'idle' | 'loading' | 'error'>('idle');
  const scanId = useRef(0);
  const chartId = useRef(0);

  const spec = universe === 'custom' ? `custom:${custom}` : universe;

  const scan = useCallback(async () => {
    const id = scanId.current + 1;
    scanId.current = id;
    setBusy(true); setMessage(''); setLoginNeeded(false);
    const collected: Row[] = [];
    try {
      for (let offset = 0; ; offset += SLICE) {
        const response = await fetch('/api/vwap/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ universe: spec, date: date || 'today', source, offset, limit: SLICE }) });
        const body = (await response.json().catch(() => null)) as { results?: Row[]; total?: number; done?: boolean; day?: string; scannedAt?: string; error?: string; loginRequired?: boolean } | null;
        if (scanId.current !== id) return;
        if (response.status === 401 || body?.loginRequired) { setLoginNeeded(true); setMessage(body?.error ?? 'Connect FYERS to scan.'); break; }
        if (!response.ok || !body?.results) { setMessage(body?.error ?? 'The scan failed.'); break; }
        collected.push(...body.results);
        setRows([...collected]); setScanDay(body.day ?? null); setScannedAt(body.scannedAt ?? null);
        setProgress({ done: collected.length, total: body.total ?? collected.length });
        if (body.done) break;
      }
    } catch { if (scanId.current === id) setMessage('Could not reach the server.'); }
    finally { if (scanId.current === id) { setBusy(false); setProgress(null); } }
  }, [spec, date, source]);

  // Auto-refresh: re-scan just after each 5-minute candle closes, while the market is open and the scan is for today.
  useEffect(() => {
    if (!auto) return;
    let timer = 0;
    const arm = () => {
      const now = Date.now();
      const nextClose = Math.floor(now / 300_000) * 300_000 + 300_000 + 8_000; // 8 s after the boundary, so the closed candle is available
      timer = window.setTimeout(() => {
        if (!date && marketSession(new Date(), HOLIDAYS) === 'open') void scan();
        arm();
      }, nextClose - now);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [auto, date, scan]);

  const openRow = useCallback((row: Row) => {
    const id = chartId.current + 1;
    chartId.current = id;
    setSelected(row); setChart(null); setChartState(row ? 'loading' : 'idle');
    fetch(`/api/vwap/chart?symbol=${encodeURIComponent(row.symbol)}&date=${scanDay ?? 'today'}&source=${source}&days=3`, { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { days?: VwapChartDay[]; error?: string } | null;
        if (chartId.current !== id) return;
        if (!response.ok || !body?.days) { setChartState('error'); return; }
        setChart({ days: body.days }); setChartState('idle');
      })
      .catch(() => { if (chartId.current === id) setChartState('error'); });
  }, [scanDay, source]);

  const sectors = useMemo(() => ['all', ...[...new Set(rows.map((r) => r.sector))].sort()], [rows]);
  const matches = useCallback((e: CrossEvent) => (direction === 'all' || e.direction === direction) && (type === 'all' || e.type === type) && (!borderlineOnly || e.borderline), [direction, type, borderlineOnly]);
  const filtered = useMemo(() => {
    const filtersOn = direction !== 'all' || type !== 'all' || borderlineOnly;
    const list = rows.filter((r) => (sector === 'all' || r.sector === sector) && (!filtersOn || r.events.some(matches)));
    const value = (r: Row): number | string => sort.key === 'ticker' ? r.ticker : sort.key === 'sector' ? r.sector : sort.key === 'distancePct' ? Math.abs(r.distancePct ?? -1) : sort.key === 'crossesToday' ? r.crossesToday : (lastCross(r)?.t ?? 0);
    return [...list].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, sector, direction, type, borderlineOnly, matches, sort]);

  const exportCsv = () => {
    const lines = ['date,symbol,sector,time,direction,type,open,close,vwap,distance_pct,borderline'];
    for (const r of filtered) for (const e of r.events.filter(matches)) lines.push([scanDay, r.ticker, `"${r.sector}"`, e.time, e.direction, e.type, e.open, e.close, e.vwap.toFixed(4), e.distancePct.toFixed(4), e.borderline].join(','));
    const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `vwap-crosses-${scanDay ?? 'scan'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const head = (key: SortKey, label: string) => (
    <th className="px-2 py-1.5 font-medium"><button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'ticker' || key === 'sector' ? 1 : -1 }))} className="hover:text-foreground">{label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>
  );
  const withCross = rows.filter((r) => r.crossesToday > 0).length;
  const errors = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="mx-auto grid max-w-5xl gap-4 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Waves className="size-5" />Monthly VWAP crossovers</h1>
        <p className="text-xs text-muted-foreground">Every closed 5-minute candle today that crossed the monthly anchored VWAP (anchored at the first candle of the month). Read-only: no orders are placed from here.</p>
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="grid gap-1">Universe
          <select className="rounded-md border border-input bg-background px-2 py-1.5" value={universe} onChange={(e) => setUniverse(e.target.value)}>{UNIVERSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        <label className="grid gap-1">Date
          <input type="date" className="rounded-md border border-input bg-background px-2 py-1.5" value={date} onChange={(e) => setDate(e.target.value)} placeholder="today" />
        </label>
        <label className="grid gap-1">Data
          <select className="rounded-md border border-input bg-background px-2 py-1.5" value={source} onChange={(e) => setSource(e.target.value as 'fyers' | 'cache')}><option value="fyers">Live FYERS</option><option value="cache">Cached history (offline)</option></select>
        </label>
        <div className="flex items-end gap-2">
          <Button size="sm" disabled={busy} onClick={() => void scan()}><RefreshCw className={busy ? 'animate-spin' : ''} />{busy ? 'Scanning…' : rows.length ? 'Rescan' : 'Scan'}</Button>
        </div>
        {universe === 'custom' ? <label className="grid gap-1 sm:col-span-4">Tickers (comma separated)<input className="rounded-md border border-input bg-background px-2 py-1.5" value={custom} onChange={(e) => setCustom(e.target.value)} /></label> : null}
        <label className="flex items-center gap-2 sm:col-span-4"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Auto-refresh a few seconds after each 5-minute candle closes (today only, market hours)</label>
      </div>

      {message ? <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">{message} {loginNeeded ? <Button size="sm" variant="outline" className="ml-2" onClick={() => { window.location.href = '/api/fyers/login'; }}><Link2 />Connect FYERS</Button> : null}</div> : null}
      {progress ? <div className="text-xs text-muted-foreground">Scanning {progress.done} of {progress.total}…</div> : null}

      {rows.length ? (
        <>
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">{scanDay}</strong>{scannedAt ? ` · scanned ${new Date(scannedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST` : ''} · {rows.length} symbols · {withCross} with a cross{errors ? ` · ${errors} errors` : ''}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'up', 'down'] as const).map((d) => <Chip key={d} active={direction === d} onClick={() => setDirection(d)}>{d === 'all' ? 'Both directions' : d === 'up' ? 'Up' : 'Down'}</Chip>)}
            <span className="mx-1 h-4 w-px bg-border" />
            {(['all', 'close-cross', 'body-cross', 'gap-cross'] as const).map((t) => <Chip key={t} active={type === t} onClick={() => setType(t)}>{t === 'all' ? 'All types' : t}</Chip>)}
            <span className="mx-1 h-4 w-px bg-border" />
            <Chip active={borderlineOnly} onClick={() => setBorderlineOnly((v) => !v)}>Borderline only</Chip>
            <select className="ml-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]" value={sector} onChange={(e) => setSector(e.target.value)}>{sectors.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sectors' : s}</option>)}</select>
            <Button size="sm" variant="outline" className="ml-auto" disabled={!filtered.length} onClick={exportCsv}><Download />CSV</Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground"><tr>{head('ticker', 'Symbol')}{head('sector', 'Sector')}<th className="px-2 py-1.5 font-medium">Now</th><th className="px-2 py-1.5 font-medium">VWAP</th><th className="px-2 py-1.5 font-medium">Close</th>{head('distancePct', '% from VWAP')}{head('crossesToday', 'Crosses')}{head('last', 'Last cross')}</tr></thead>
              <tbody>
                {filtered.map((r) => {
                  const last = lastCross(r);
                  return (
                    <tr key={r.symbol} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => r.status === 'ok' && openRow(r)}>
                      <td className="px-2 py-1.5 font-semibold">{r.ticker}{r.unreliable ? <span title={r.unreliableNote} className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] font-normal text-amber-700 dark:text-amber-400">VWAP unreliable</span> : null}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.sector}</td>
                      {r.status !== 'ok' ? <td className="px-2 py-1.5 text-muted-foreground" colSpan={6}>{r.status === 'error' ? `Error: ${r.error ?? 'scan failed'}` : 'No session on this date'}</td> : <>
                        <td className={`px-2 py-1.5 ${r.side === 'above' ? 'text-emerald-600' : r.side === 'below' ? 'text-red-600' : ''}`}>{r.side ?? '–'}{r.borderlineNow ? ' ~' : ''}</td>
                        <td className="px-2 py-1.5 tabular-nums">{num(r.vwap)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{num(r.lastClose)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.distancePct === null ? '–' : `${r.distancePct >= 0 ? '+' : ''}${r.distancePct.toFixed(3)}%`}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.crossesToday}</td>
                        <td className="px-2 py-1.5">{last ? <span className={last.direction === 'up' ? 'text-emerald-600' : 'text-red-600'}>{last.time} {last.direction} · {last.type}{last.borderline ? ' · borderline' : ''}</span> : <span className="text-muted-foreground">none</span>}</td>
                      </>}
                    </tr>
                  );
                })}
                {!filtered.length ? <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No symbols match these filters.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">~ marks a close within 0.05% of the VWAP (price sitting on the line). Times are candle start times in IST: the 10:40 candle closes at 10:45. A candle still forming is never used.</p>
        </>
      ) : !busy ? <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-xs text-muted-foreground">Pick a universe and press Scan. The first scan of a month fetches the month&apos;s candles; later scans only fetch today.</div> : null}

      <Dialog open={selected !== null} onOpenChange={(next) => { if (!next) { chartId.current += 1; setSelected(null); setChart(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.ticker} · {selected.crossesToday} cross{selected.crossesToday === 1 ? '' : 'es'} on {scanDay}</DialogTitle>
                <DialogDescription>{selected.sector} · month VWAP {num(selected.vwap)} · close {num(selected.lastClose)} · {selected.sessionsInMonth + 1} session{selected.sessionsInMonth ? 's' : ''} in the month so far</DialogDescription>
              </DialogHeader>
              {chartState === 'loading' ? <div className="flex h-[320px] items-center justify-center text-xs text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />Loading chart…</div> : null}
              {chartState === 'error' ? <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Could not load the chart.</div> : null}
              {chart ? <Suspense fallback={<div className="h-[320px]" />}><VwapChart days={chart.days} /></Suspense> : null}
              <p className="text-[11px] text-muted-foreground"><span className="text-amber-500">━ month VWAP</span> · ▲ up cross · ▼ down cross · ~ borderline. Last three sessions shown.</p>
              <ul className="grid gap-1 text-xs">
                {selected.events.map((e) => <li key={e.t} className="flex flex-wrap gap-x-3 rounded-md bg-muted/40 px-2 py-1"><strong className={e.direction === 'up' ? 'text-emerald-600' : 'text-red-600'}>{e.time} {e.direction}</strong><span>{e.type}</span><span className="tabular-nums">close {num(e.close)} · VWAP {num(e.vwap)}</span>{e.borderline ? <span className="text-amber-600">borderline</span> : null}</li>)}
                {!selected.events.length ? <li className="text-muted-foreground">No crosses today.{selected.wickTouches ? ` The VWAP was touched by a wick ${selected.wickTouches} time${selected.wickTouches === 1 ? '' : 's'} without a close across it.` : ''}</li> : null}
              </ul>
              {selected.flags.length || selected.unreliable || selected.formingExcluded ? <ul className="grid gap-1 text-[11px] text-muted-foreground">{[...selected.flags, ...(selected.unreliable ? [`VWAP unreliable: ${selected.unreliableNote}`] : []), ...(selected.formingExcluded ? ['The candle still forming was left out.'] : [])].map((f) => <li key={f}>• {f}</li>)}</ul> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
