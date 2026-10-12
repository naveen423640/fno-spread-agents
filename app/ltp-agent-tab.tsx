'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AgentState, WatchRow } from '@/lib/ltp-agent/state';
import { istHhmm } from '@/lib/ltp/time';
import { colour, inr, short, TradeCard } from '@/app/ltp-agent-parts/trade-card';
import { AgentExperiments } from '@/app/ltp-agent-parts/experiments';
import { AgentJournal } from '@/app/ltp-agent-parts/journal';
import { LineChart } from '@/app/ltp-agent-parts/line-chart';

const BADGE = { green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', red: 'bg-red-500/15 text-red-700 dark:text-red-400' };
type Section = 'today' | 'performance' | 'journal' | 'experiments';
const SECTIONS: [Section, string][] = [['today', 'Today'], ['performance', 'Performance'], ['journal', 'Journal'], ['experiments', 'Experiments']];

const BLOCKED: Record<string, string> = {
  scenario_allowed: 'the current scenario does not allow this side', time_window: 'outside the trading window right now', valid_plan: 'no usable stop or target', hit_number: 'too many touches of this level already today',
  coa2_agree: 'COA 2.0 does not agree', soc_opposes: 'an opposing State of Confusion is active', daily_trade_cap: 'the daily trade cap is reached', max_concurrent: 'a trade is already open', daily_loss_cap: 'the daily loss cap is reached',
};
const pts = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(0)}`;

// "Where would you trade now?": the levels the agent is watching for each underlying, the plan at each, and what stops it if it would not trade there yet.
function Watch({ rows }: { rows: WatchRow[] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">No snapshots recorded yet, so there is nothing to watch.</p>;
  return (
    <div className="grid gap-3">
      {rows.map((r) => {
        const next = r.levels.find((l) => l.wouldTrade);
        return (
          <div key={r.underlying} className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="mb-1 flex flex-wrap items-baseline gap-x-3"><strong className="text-sm">{short(r.underlying)}</strong><span className="tabular-nums">spot {r.spot.toLocaleString('en-IN')}</span><span className="text-muted-foreground">scenario {r.scenario} ({r.scenarioBias}) · banner {r.banner} · as of {r.date.slice(5)} {istHhmm(r.asOf)} IST</span></div>
            <p className={`mb-2 rounded-md px-2 py-1.5 font-semibold ${next ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-muted/60 text-muted-foreground'}`}>
              {next ? `Next trade level: ${next.direction.toUpperCase()} at ${next.label} ${next.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${Math.abs(next.distance).toFixed(0)} pts ${next.distance > 0 ? 'above' : 'below'} the spot), stop ${next.stop?.toFixed(0)}, target ${next.target?.toFixed(0)}.` : 'No level would be traded right now (see why below).'}
            </p>
            <table className="w-full tabular-nums"><thead className="text-muted-foreground"><tr><th className="text-left font-normal">Side</th><th className="text-left font-normal">Level</th><th className="text-right font-normal">Price</th><th className="text-right font-normal">From spot</th><th className="text-right font-normal">Stop</th><th className="text-right font-normal">Target</th><th className="text-right font-normal">Risk : reward</th><th className="text-left pl-3 font-normal">Would it trade?</th></tr></thead>
              <tbody>{r.levels.map((l) => (
                <tr key={`${l.setup}-${l.direction}-${l.label}`} className={`border-t border-border ${l === next ? 'bg-emerald-500/10' : ''}`}>
                  <td className={`font-semibold ${l.direction === 'long' ? 'text-emerald-600' : 'text-red-600'}`}>{l.direction.toUpperCase()}</td>
                  <td>{l.label}<span className="text-muted-foreground"> · {l.setup === 'coa1_reversal' ? 'COA 1.0' : l.setup === 'nine_twenty' ? '9:20' : 'SOC'}</span></td>
                  <td className="text-right">{l.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td className="text-right">{pts(l.distance)}</td>
                  <td className="text-right">{l.stop?.toFixed(0) ?? '–'}</td><td className="text-right">{l.target?.toFixed(0) ?? '–'}</td>
                  <td className="text-right">{l.plannedRiskPts?.toFixed(0) ?? '–'} : {l.rewardPts?.toFixed(0) ?? '–'}</td>
                  <td className="pl-3">{l.wouldTrade ? <span className="font-semibold text-emerald-600">yes, on a touch (hit #{l.hit})</span> : <span className="text-amber-700 dark:text-amber-400">no: {BLOCKED[l.blockedBy ?? ''] ?? l.blockedBy}</span>}</td>
                </tr>))}</tbody></table>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">The agent trades a level only when the spot comes within the touch tolerance of it. EOS/EOR-based prices are proxies and move with the options&apos; prices; this view refreshes every minute.</p>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Record<string, { n: number; buyNet: number; sellNet: number }> }) {
  const keys = Object.keys(rows).sort();
  return (
    <div className="rounded-lg border border-border bg-card p-2 text-xs">
      <div className="mb-1 font-semibold">{title}</div>
      {keys.length ? <table className="w-full tabular-nums"><thead className="text-muted-foreground"><tr><th className="text-left font-normal">Group</th><th className="text-right font-normal">Trades</th><th className="text-right font-normal">BUY net</th><th className="text-right font-normal">SELL net</th></tr></thead>
        <tbody>{keys.map((k) => <tr key={k} className="border-t border-border"><td>{k.includes(':') ? short(k) : k}</td><td className="text-right">{rows[k].n}</td><td className={`text-right ${colour(rows[k].buyNet)}`}>{inr(rows[k].buyNet)}</td><td className={`text-right ${colour(rows[k].sellNet)}`}>{inr(rows[k].sellNet)}</td></tr>)}</tbody></table> : <span className="text-muted-foreground">No closed trades yet.</span>}
    </div>
  );
}

export function LtpAgentTab() {
  const [state, setState] = useState<AgentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('today');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ltp/agent/state', { cache: 'no-store' });
      const body = (await res.json()) as AgentState | { error: string };
      if ('error' in body) throw new Error(body.error);
      setState(body); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read the agent state.'); }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 60_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);

  async function togglePause() {
    if (!state) return;
    setBusy(true);
    try {
      await fetch('/api/ltp/agent/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: state.header.paused ? 'resume' : 'pause' }) });
      await load();
    } finally { setBusy(false); }
  }

  const equitySeries = useMemo(() => {
    if (!state) return [];
    const p = state.performance;
    const line = (title: string, color: string, pts: { ts: number; equity: number }[]) => ({ title, color, points: pts.map((x) => ({ ts: x.ts, value: x.equity })) });
    return [line('BUY', '#3b82f6', p.equity.buy), line('SELL', '#f59e0b', p.equity.sell)];
  }, [state]);
  const versionSeries = useMemo(() => {
    if (!state) return [];
    const palette = ['#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#14b8a6'];
    return Object.entries(state.performance.byVersion).flatMap(([v, books], i) => [
      { title: `v${v} BUY`, color: palette[i % palette.length], points: books.buy.map((x) => ({ ts: x.ts, value: x.equity })) },
      { title: `v${v} SELL`, color: `${palette[i % palette.length]}99`, points: books.sell.map((x) => ({ ts: x.ts, value: x.equity })) },
    ]);
  }, [state]);

  const h = state?.header;
  const book = (b: 'buy' | 'sell') => state?.performance.buyVsSell[b];
  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-3 px-3 py-4">
      {h ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-slate-900 px-2.5 py-1 font-semibold text-white">Strategy v{h.activeVersion}</span>
          <span className={`rounded-md px-2.5 py-1 font-semibold ${h.phase.unlocked ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>{h.phase.counter}</span>
          <span className={`rounded-md px-2 py-1 font-medium ${BADGE[h.recorder.badge]}`}>Recorder {h.recorder.badge === 'green' ? 'recording' : h.recorder.badge === 'amber' ? 'lagging' : 'stopped'}{h.recorder.lastSuccessTs ? ` · last ${istHhmm(h.recorder.lastSuccessTs)}` : ''}</span>
          <span className={`rounded-md px-2 py-1 font-medium ${BADGE[h.heartbeat]}`}>Agent heartbeat {h.heartbeatAgeSeconds === null ? 'none yet' : `${h.heartbeatAgeSeconds}s ago`}</span>
          <Button size="sm" variant={h.paused ? 'default' : 'outline'} onClick={() => void togglePause()} disabled={busy}>{h.paused ? <Play /> : <Pause />}{h.paused ? 'Resume paper trading' : 'Pause paper trading'}</Button>
          <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw />Refresh</Button>
          {h.paused ? <span className="font-semibold text-amber-600">PAUSED: no new trades; open trades are still managed.</span> : null}
        </div>
      ) : null}
      {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</p> : null}
      {h && h.heartbeat === 'red' && h.heartbeatAgeSeconds === null ? <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">The agent has not run yet. Start it with <code>npm run agent-run</code> (the recorder must be running too); it steps the agent once a minute during market hours.</p> : null}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {SECTIONS.map(([id, label]) => <button key={id} type="button" onClick={() => setSection(id)} className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${section === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
      </div>

      {section === 'today' && state ? (
        <div className="grid gap-3">
          <h2 className="text-sm font-semibold">Where the agent would trade now</h2>
          <Watch rows={state.watch ?? []} />
          <h2 className="text-sm font-semibold">Open trades ({state.today.open.length})</h2>
          {state.today.open.length ? state.today.open.map((t) => <TradeCard key={t.decisionId} t={t} />) : <p className="text-xs text-muted-foreground">No open trades.</p>}
          <h2 className="text-sm font-semibold">Closed today ({state.today.closed.length})</h2>
          {state.today.closed.length ? state.today.closed.map((t) => <TradeCard key={t.decisionId} t={t} />) : <p className="text-xs text-muted-foreground">No trades closed today.</p>}
          <h2 className="text-sm font-semibold">Skipped signals ({state.today.skipped.length}). No trade is always a valid decision.</h2>
          {state.today.skipped.length ? (
            <div className="grid gap-1">{state.today.skipped.map((s) => <div key={s.decisionId} className="rounded-md border border-border px-3 py-1.5 text-xs"><span className="mr-2 tabular-nums text-muted-foreground">{istHhmm(s.ts)}</span><span className="mr-2 rounded bg-slate-500/15 px-1.5 py-0.5 font-semibold">{s.skipReason}</span>{s.reason}</div>)}</div>
          ) : <p className="text-xs text-muted-foreground">Nothing skipped today.</p>}
        </div>
      ) : null}

      {section === 'performance' && state ? (
        <div className="grid gap-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-3"><h3 className="mb-1 text-xs font-semibold">Equity (net of charges), per book</h3><LineChart series={equitySeries} empty="No closed trades yet." /></div>
            <div className="rounded-lg border border-border bg-card p-3"><h3 className="mb-1 text-xs font-semibold">Equity per strategy version</h3><LineChart series={versionSeries} empty="No closed trades yet." /></div>
          </div>
          <div className="rounded-lg border border-border bg-card p-2 text-xs">
            <div className="mb-1 font-semibold">BUY versus SELL (every signal is booked in both)</div>
            <table className="w-full tabular-nums"><thead className="text-muted-foreground"><tr><th className="text-left font-normal">Book</th><th className="text-right font-normal">Trades</th><th className="text-right font-normal">Net</th><th className="text-right font-normal">Win rate</th><th className="text-right font-normal">Expectancy / trade</th></tr></thead>
              <tbody>{(['buy', 'sell'] as const).map((b) => <tr key={b} className="border-t border-border"><td className="uppercase">{b}</td><td className="text-right">{book(b)?.n}</td><td className={`text-right ${colour(book(b)?.net ?? 0)}`}>{inr(book(b)?.net ?? 0)}</td><td className="text-right">{Math.round((book(b)?.winRate ?? 0) * 100)}%</td><td className={`text-right ${colour(book(b)?.expectancy ?? 0)}`}>{inr(book(b)?.expectancy ?? 0)}</td></tr>)}</tbody></table>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Group title="By setup" rows={state.performance.breakdowns.bySetup} />
            <Group title="By COA 1.0 scenario" rows={state.performance.breakdowns.byScenario} />
            <Group title="By hit number" rows={state.performance.breakdowns.byHit} />
            <Group title="By time of day" rows={state.performance.breakdowns.byTimeBucket} />
            <Group title="By underlying" rows={state.performance.breakdowns.byUnderlying} />
            <div className="rounded-lg border border-border bg-card p-2 text-xs"><div className="mb-1 font-semibold">Mistake tags (from reviews)</div>{Object.keys(state.performance.breakdowns.byTag).length ? Object.entries(state.performance.breakdowns.byTag).sort((a, b) => b[1] - a[1]).map(([t, n]) => <div key={t} className="flex justify-between border-t border-border first:border-t-0"><span>{t.replace(/_/g, ' ')}</span><span className="tabular-nums">{n}</span></div>) : <span className="text-muted-foreground">No reviews yet.</span>}</div>
          </div>
        </div>
      ) : null}

      {section === 'journal' ? <AgentJournal /> : null}
      {section === 'experiments' ? <AgentExperiments /> : null}

      <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">Paper trading only. EOS/EOR are proxies. Results are not validated for live trading.</p>
    </div>
  );
}
