'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FlaskConical, Link2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { BacktestReport, ReportRow } from '@/lib/board/backtest';

type Status = { loaded: number; total: number };
type Payload = { status: Status; report: BacktestReport | null; computedAt: string | null; computedOnSymbols: number | null };

const pct = (v: number | null, digits = 2) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);
const num = (v: number | null) => (v === null ? '–' : v.toFixed(2));
const HORIZONS: [string, string][] = [['30m', '+30 min'], ['60m', '+60 min'], ['close', 'To close']];

const post = (action: 'load' | 'run') => fetch('/api/board/backtest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });

function verdictTone(verdict: string) {
  if (verdict.startsWith('score beats')) return 'text-emerald-600';
  if (verdict.startsWith('baseline beats')) return 'text-red-600';
  return 'text-muted-foreground';
}

function ReportTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-left text-[11px]">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{['Group', 'Sessions', 'Picks/board', 'Mean', 'After cost', 'Hit rate', 'Baseline mean', 'Score − baseline', 't', 'Verdict'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.group}-${r.checkpoint}-${r.horizon}`} className="border-t border-border align-top">
              <td className="px-2 py-1.5 font-medium">{r.group}<div className="font-normal text-muted-foreground">vs {r.baseline}</div></td>
              <td className="px-2 py-1.5 tabular-nums">{r.sessions}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.avgPicksPerBoard.toFixed(1)}</td>
              <td className="px-2 py-1.5 tabular-nums">{pct(r.meanPct)}</td>
              <td className="px-2 py-1.5 tabular-nums">{pct(r.netMeanPct)}</td>
              <td className="px-2 py-1.5 tabular-nums">{(r.hitRate * 100).toFixed(0)}%</td>
              <td className="px-2 py-1.5 tabular-nums">{pct(r.baselineMeanPct)}</td>
              <td className="px-2 py-1.5 tabular-nums">{pct(r.diffPct)}</td>
              <td className="px-2 py-1.5 tabular-nums">{num(r.diffT)}</td>
              <td className={`px-2 py-1.5 ${verdictTone(r.verdict)}`}>{r.verdict}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BoardBacktest() {
  const [data, setData] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'load' | 'run' | null>(null);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [checkpoint, setCheckpoint] = useState('all');
  const [horizon, setHorizon] = useState('60m');

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/board/backtest', { cache: 'no-store' });
        if (response.ok) setData((await response.json()) as Payload);
      } catch { setMessage('Could not reach the server.'); }
    })();
  }, []);

  // Loads 20 symbols per request and repeats until every symbol is cached (or something fails).
  const load = useCallback(async () => {
    setBusy('load'); setMessage('');
    try {
      for (let round = 0; round < 40; round += 1) {
        const response = await post('load');
        const body = (await response.json().catch(() => null)) as { loaded?: number; total?: number; done?: boolean; loginRequired?: boolean; failed?: { symbol: string; message: string }[] } | null;
        if (response.status === 401 || body?.loginRequired) { setLoginNeeded(true); setMessage('Connect FYERS to load history.'); break; }
        if (!body) { setMessage('The load request failed.'); break; }
        setLoginNeeded(false);
        setData((current) => (current ? { ...current, status: { loaded: body.loaded ?? 0, total: body.total ?? 0 } } : current));
        if (body.failed?.length) setMessage(`${body.failed.length} symbol(s) failed and will be retried: ${body.failed[0].symbol}: ${body.failed[0].message}`);
        if (body.done) { setMessage('All history loaded.'); break; }
        if ((body.failed?.length ?? 0) >= 20) break;
      }
    } catch { setMessage('Could not reach the server.'); } finally { setBusy(null); }
  }, []);

  const run = useCallback(async () => {
    setBusy('run'); setMessage('Replaying sessions… this can take a few seconds.');
    try {
      const response = await post('run');
      const body = (await response.json().catch(() => null)) as { report?: BacktestReport; computedAt?: string; computedOnSymbols?: number; error?: string } | null;
      if (!response.ok || !body?.report) { setMessage(body?.error ?? 'The backtest failed.'); return; }
      setData((current) => (current ? { ...current, report: body.report ?? null, computedAt: body.computedAt ?? null, computedOnSymbols: body.computedOnSymbols ?? null } : current));
      setMessage('');
    } catch { setMessage('Could not reach the server.'); } finally { setBusy(null); }
  }, []);

  const report = data?.report ?? null;
  const rows = report ? report.rows.filter((r) => r.checkpoint === checkpoint && r.horizon === horizon) : [];
  const complete = data ? data.status.loaded >= data.status.total && data.status.total > 0 : false;
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4" />Does the score add an edge?</h2>
        <p className="text-xs text-muted-foreground">Replays past sessions at 09:30, 10:00 and 10:30 through the same scoring as the live board, and compares the top picks with a plain top gainers / top losers scan.</p>
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
        <div>History cached: <strong>{data ? `${data.status.loaded} of ${data.status.total}` : '…'}</strong> symbols{complete ? ' · complete' : ' · about 100 days of 5-minute candles, daily candles and futures OI each'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null || complete} onClick={() => void load()}><Download className={busy === 'load' ? 'animate-pulse' : ''} />{busy === 'load' ? 'Loading…' : complete ? 'History loaded' : data && data.status.loaded > 0 ? 'Continue loading' : 'Load history'}</Button>
          <Button size="sm" disabled={busy !== null || !data || data.status.loaded < 25} onClick={() => void run()}><Play />{report ? 'Run again' : 'Run backtest'}</Button>
          {loginNeeded ? <Button size="sm" variant="outline" onClick={() => { window.location.href = '/api/fyers/login'; }}><Link2 />Connect FYERS</Button> : null}
        </div>
        {message ? <div className="text-amber-700 dark:text-amber-400">{message}</div> : null}
        {!complete ? <div className="text-muted-foreground">Loading takes roughly 6 minutes the first time (about 650 FYERS history calls, paced). It resumes where it stopped and is stored, so later runs are instant.</div> : null}
      </div>

      {report ? (
        <>
          <div className="text-xs text-muted-foreground">
            {report.sessions} sessions replayed ({report.firstDay} to {report.lastDay}) · {report.replayedBoards} boards · {data?.computedOnSymbols ?? report.stocks} stocks · entry at the checkpoint close, long for bullish and short for bearish, equal weight.
          </div>
          {report.warnings.length ? <ul className="grid gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px]">{report.warnings.map((w) => <li key={w}>• {w}</li>)}</ul> : null}
          <div className="flex flex-wrap gap-1.5">
            {['all', ...report.checkpoints].map((c) => <button key={c} type="button" aria-pressed={checkpoint === c} onClick={() => setCheckpoint(c)} className={`rounded-full border px-2.5 py-1 text-[11px] ${checkpoint === c ? 'border-foreground/40 bg-muted font-medium' : 'border-border text-muted-foreground'}`}>{c === 'all' ? 'All checkpoints' : c}</button>)}
            <span className="mx-1 w-px bg-border" />
            {HORIZONS.map(([id, label]) => <button key={id} type="button" aria-pressed={horizon === id} onClick={() => setHorizon(id)} className={`rounded-full border px-2.5 py-1 text-[11px] ${horizon === id ? 'border-foreground/40 bg-muted font-medium' : 'border-border text-muted-foreground'}`}>{label}</button>)}
          </div>
          {rows.length ? <ReportTable rows={rows} /> : <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">No boards had picks for this view.</div>}
          <p className="text-[11px] text-muted-foreground">Mean is the average directional return per session. A positive &quot;Score − baseline&quot; with a t of 2 or more over 30+ sessions would suggest the score adds something; anything less is consistent with luck.</p>
        </>
      ) : <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">No report yet. Load the history, then run the backtest.</div>}
    </div>
  );
}
