'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Link2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BOARD_CONFIG } from '@/lib/board/config';
import { marketSession } from '@/lib/market-session';
import type { BoardEntry, BoardPayload, ScoreComponents } from '@/lib/board/types';
import { HOLIDAYS } from '@/lib/screener/holidays';

const POLL_MS = BOARD_CONFIG.poll.intervalSeconds * 1000;
const COMPONENT_LABELS: [keyof ScoreComponents, string][] = [['move', 'Move vs ATR'], ['volume', 'Volume'], ['oi', 'Futures OI'], ['sector', 'Sector']];

const price = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v);
const signed = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;

function istTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

// Bars run from the centre: right is bullish, left is bearish.
function ComponentBars({ components }: { components: ScoreComponents }) {
  return (
    <div className="grid gap-1.5">
      {COMPONENT_LABELS.map(([key, label]) => {
        const value = components[key];
        return (
          <div key={key} className="grid grid-cols-[88px_1fr_40px] items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">{label}</span>
            <div className="relative h-2 rounded-full bg-muted">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div className={`absolute inset-y-0 rounded-full ${value >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ left: value >= 0 ? '50%' : `${50 + value * 50}%`, width: `${Math.abs(value) * 50}%` }} />
            </div>
            <span className="text-right tabular-nums">{signed(value, 2)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EntryRow({ entry, rank, onOpen }: { entry: BoardEntry; rank: number; onOpen: () => void }) {
  const bull = entry.direction === 'bull';
  return (
    <button type="button" onClick={onOpen} className="grid w-full grid-cols-[22px_1fr_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
      <span className="text-xs tabular-nums text-muted-foreground">{rank}</span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-2"><strong className="truncate text-sm">{entry.ticker}</strong><span className="truncate text-[11px] text-muted-foreground">{entry.sector}</span></span>
        <span className="text-[11px] text-muted-foreground">₹{price(entry.price)} · {signed(entry.changePct)}% · {entry.moveAtr >= 0 ? '+' : ''}{entry.moveAtr.toFixed(1)} ATR · {entry.oi}{entry.volumeRatio !== null ? ` · vol ${entry.volumeRatio.toFixed(1)}x` : ''}</span>
      </span>
      <span className={`rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${bull ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>{Math.abs(entry.score).toFixed(0)}</span>
    </button>
  );
}

function Section({ title, entries, tone, onOpen }: { title: string; entries: BoardEntry[]; tone: 'bull' | 'bear'; onOpen: (e: BoardEntry) => void }) {
  return (
    <section className="grid gap-2">
      <h2 className={`text-sm font-semibold ${tone === 'bull' ? 'text-emerald-600' : 'text-red-600'}`}>{title} <span className="font-normal text-muted-foreground">· top {entries.length}</span></h2>
      {entries.length ? entries.map((e, i) => <EntryRow key={e.symbol} entry={e} rank={i + 1} onOpen={() => onOpen(e)} />) : <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">No setups pass the filters right now.</div>}
    </section>
  );
}

export function BoardTab() {
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [status, setStatus] = useState('');
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BoardEntry | null>(null);
  const triedFirstSnapshot = useRef(false);

  const loadBoard = useCallback(async () => {
    const response = await fetch('/api/board', { cache: 'no-store' });
    if (!response.ok) throw new Error('board');
    setBoard((await response.json()) as BoardPayload);
  }, []);

  type PollBody = { ok?: boolean; loginRequired?: boolean; skipped?: string; stocks?: number; errors?: string[]; failedBatches?: number; baselines?: { done: number; total: number }; oi?: { known: number; total: number } };

  const poll = useCallback(async (force: boolean): Promise<PollBody | null> => {
    const response = await fetch('/api/board/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) });
    const body = (await response.json().catch(() => null)) as PollBody | null;
    if (response.status === 401 || body?.loginRequired) { setLoginNeeded(true); setStatus('Connect FYERS to record data.'); return null; }
    setLoginNeeded(false);
    if (body && !body.ok) setStatus(body.errors?.[0] ?? 'The snapshot could not be recorded.');
    else if (body?.failedBatches) setStatus(`Recorded ${body.stocks} stocks; ${body.failedBatches} request(s) failed and were skipped.`);
    else setStatus('');
    return body;
  }, []);

  // A forced load (market closed, or the very first snapshot) repeats until the daily baselines and OI are filled in, up to 12 rounds.
  const refresh = useCallback(async (force: boolean) => {
    setBusy(true);
    try {
      for (let round = 0; round < (force ? 12 : 1); round += 1) {
        const body = await poll(force);
        await loadBoard();
        if (!body?.ok) break;
        const baselinesLeft = (body.baselines?.total ?? 0) - (body.baselines?.done ?? 0);
        const oiLeft = (body.oi?.total ?? 0) - (body.oi?.known ?? 0);
        if (baselinesLeft <= 0 && oiLeft <= 0) break;
        setStatus(`Loading daily baselines ${body.baselines?.done}/${body.baselines?.total} and futures OI ${body.oi?.known}/${body.oi?.total}…`);
      }
    } catch { setStatus('Could not reach the server.'); } finally { setBusy(false); }
  }, [poll, loadBoard]);

  // Read what is stored, record the first snapshot if there is none, then keep recording once a minute while the market is open.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadBoard();
      } catch { if (!cancelled) setStatus('Could not load the board.'); }
    })();
    const timer = window.setInterval(() => {
      if (marketSession(new Date(), HOLIDAYS) === 'open') void refresh(false);
    }, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [loadBoard, refresh]);

  useEffect(() => {
    if (board && !board.asOf && !triedFirstSnapshot.current) {
      triedFirstSnapshot.current = true;
      void refresh(true);
    }
  }, [board, refresh]);

  const open = marketSession(new Date(), HOLIDAYS) === 'open';
  return (
    <div className="mx-auto grid max-w-3xl gap-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Layers className="size-5" />OrderBlock Board</h1>
          <p className="text-xs text-muted-foreground">Strongest bullish and bearish F&amp;O setups, scored each minute. Read-only: no orders are placed from here.</p>
        </div>
        <div className="flex items-center gap-2">
          {loginNeeded ? <Button size="sm" variant="outline" onClick={() => { window.location.href = '/api/fyers/login'; }}><Link2 />Connect FYERS</Button> : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh(!open)}><RefreshCw className={busy ? 'animate-spin' : ''} />{open ? 'Refresh' : 'Load last close'}</Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {board?.asOf ? <><strong className="text-foreground">{board.live ? 'Live' : 'Last session'}</strong> · {istTime(board.asOf)} IST · {board.coverage.scored} of {board.coverage.symbols} stocks scored{board.live ? ' · updates every minute' : ''}</> : 'No snapshot recorded yet.'}
        {status ? <div className="mt-1 text-amber-700 dark:text-amber-400">{status}</div> : null}
      </div>

      {board ? (
        <>
          <Section title="Bullish" entries={board.bullish} tone="bull" onOpen={setSelected} />
          <Section title="Bearish" entries={board.bearish} tone="bear" onOpen={setSelected} />
          {board.notes.length ? <ul className="grid gap-1 text-[11px] text-muted-foreground">{board.notes.map((n) => <li key={n}>• {n}</li>)}</ul> : null}
        </>
      ) : <div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>}

      <p className="text-[11px] text-muted-foreground">Analysis, not advice. Scores rank how strongly a stock is moving today; they are untested as a trading signal until the backtest shows an edge.</p>

      <Dialog open={selected !== null} onOpenChange={(next) => { if (!next) setSelected(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.ticker} · {selected.direction === 'bull' ? 'Bullish' : 'Bearish'} {Math.abs(selected.score).toFixed(0)}</DialogTitle>
                <DialogDescription>{selected.sector} · ₹{price(selected.price)} · {signed(selected.changePct)}% today</DialogDescription>
              </DialogHeader>
              <ComponentBars components={selected.components} />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted/40 p-2"><div className="text-muted-foreground">Move</div>{selected.moveAtr >= 0 ? '+' : ''}{selected.moveAtr.toFixed(2)} daily ATRs</div>
                <div className="rounded-md bg-muted/40 p-2"><div className="text-muted-foreground">Volume vs normal</div>{selected.volumeRatio !== null ? `${selected.volumeRatio.toFixed(2)}x` : 'n/a'}</div>
                <div className="rounded-md bg-muted/40 p-2"><div className="text-muted-foreground">Futures OI</div>{selected.oiChangePct !== null ? `${signed(selected.oiChangePct)}% · ${selected.oi}` : 'n/a'}</div>
                <div className="rounded-md bg-muted/40 p-2"><div className="text-muted-foreground">Sector</div>{selected.sector}</div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
