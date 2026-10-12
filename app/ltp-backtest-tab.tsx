'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { BacktestResult } from '@/lib/ltp-agent/backtest';
import { istHhmm } from '@/lib/ltp/time';
import { colour, inr, short, TradeCard } from '@/app/ltp-agent-parts/trade-card';

const BLOCKED: Record<string, string> = {
  scenario_allowed: 'no level for this side', time_window: 'outside window', valid_plan: 'no usable SL/target', hit_number: 'too many touches',
  coa2_agree: 'COA2 must agree', soc_opposes: 'opposing SOC', daily_trade_cap: 'trade cap', max_concurrent: 'trade open', daily_loss_cap: 'loss cap', book_quote: 'no option quote',
};

type Bound = { min: number; max: number; integer?: boolean } | { values: (string | boolean)[] };
type Options = { days: string[]; versions: { version: string; changelog: string; active: boolean }[]; activeVersion: string; tunables: Record<string, Bound>; experiments: { id: string; status: string; hypothesis: string; diff: Record<string, unknown>; baseVersion: string }[] };
type WithBaseline = BacktestResult & { baseline?: { label: string; summary: BacktestResult['summary'] } };

// What the agent WOULD have traded on days the recorder stored, run in a throwaway journal: nothing here is a live trade and nothing is saved.
export function LtpBacktestTab() {
  const [options, setOptions] = useState<Options | null>(null);
  const [version, setVersion] = useState('');
  const [experiment, setExperiment] = useState('');
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState(false);
  const days = options?.days ?? [];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<WithBaseline | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/ltp/agent/backtest?list=1', { cache: 'no-store' }).then((r) => r.json() as Promise<Options>).then((b) => {
        setOptions(b);
        setVersion(b.activeVersion);
        const list = b.days ?? [];
        if (list.length) { setFrom(list[list.length - 1]); setTo(list[list.length - 1]); }
      }).catch(() => setError('Unable to read the recorded days.'));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function run() {
    setRunning(true); setError(null); setResult(null);
    try {
      // Only the fields you filled in are changed; the rest keep the chosen version's values.
      const overrides: Record<string, unknown> = {};
      for (const [path, raw] of Object.entries(changes)) {
        if (raw === '') continue;
        const bound = options?.tunables[path];
        overrides[path] = bound && 'values' in bound ? (raw === 'true' ? true : raw === 'false' ? false : raw) : Number(raw);
      }
      const q = new URLSearchParams({ from, to, version });
      if (experiment) q.set('experiment', experiment);
      if (Object.keys(overrides).length) q.set('overrides', JSON.stringify(overrides));
      if (compare) q.set('compare', '1');
      const res = await fetch(`/api/ltp/agent/backtest?${q}`, { cache: 'no-store' });
      const body = (await res.json()) as WithBaseline | { error: string };
      if ('error' in body) throw new Error(body.error);
      setResult(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'The backtest failed.'); } finally { setRunning(false); }
  }

  const s = result?.summary;
  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-3 px-3 py-4">
      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">
        <strong>Backtest of recorded days.</strong> This replays the days our recorder stored through any strategy you choose (the active version by default) and lists the trades it <em>would</em> have taken, with the reason for each and for each skip. It is separate from the live journal: nothing here is a live paper trade, and nothing is saved. A few days prove nothing about an edge, and a day recorded late or with gaps is not what the real tool saw.
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">From
          <select value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} className="rounded-md border border-border bg-background px-2 py-1">{days.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <label className="flex items-center gap-1.5">To
          <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1">{days.filter((d) => d >= from).map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <Button size="sm" onClick={() => void run()} disabled={running || !from}>{running ? 'Running…' : 'Run backtest'}</Button>
        <span className="text-muted-foreground">{days.length ? `${days.length} recorded day${days.length === 1 ? '' : 's'}. About 20 seconds per day; at most 5 days at a time.` : 'No recorded days yet.'}</span>
      </div>
      {options ? (
        <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">Strategy
              <select value={version} onChange={(e) => setVersion(e.target.value)} disabled={experiment !== ''} className="rounded-md border border-border bg-background px-2 py-1">{options.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.active ? ' (active)' : ''}</option>)}</select></label>
            <label className="flex items-center gap-1.5">Agent experiment
              <select value={experiment} onChange={(e) => setExperiment(e.target.value)} className="max-w-[320px] rounded-md border border-border bg-background px-2 py-1"><option value="">none</option>{options.experiments.map((e) => <option key={e.id} value={e.id}>{e.id} ({e.status.replace(/_/g, ' ')}): {e.hypothesis.slice(0, 50)}</option>)}</select></label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />Also run the active version, to compare</label>
          </div>
          <details>
            <summary className="cursor-pointer font-semibold">Try your own changes (only these fields can change; leave a box empty to keep the strategy&apos;s value)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(options.tunables).map(([path, b]) => (
                <label key={path} className="flex items-center justify-between gap-2">{path}
                  {'values' in b
                    ? <select value={changes[path] ?? ''} onChange={(e) => setChanges({ ...changes, [path]: e.target.value })} className="w-32 rounded-md border border-border bg-background px-2 py-1"><option value="">(unchanged)</option>{b.values.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}</select>
                    : <input type="number" min={b.min} max={b.max} step={b.integer ? 1 : 'any'} placeholder={`${b.min} to ${b.max}`} value={changes[path] ?? ''} onChange={(e) => setChanges({ ...changes, [path]: e.target.value })} className="w-32 rounded-md border border-border bg-background px-2 py-1" />}
                </label>
              ))}
            </div>
          </details>
          <p className="text-muted-foreground">Trying a strategy here never changes the active version or the live journal. Choosing an experiment replays it on the version it was proposed against, whatever its status, so you can see what an idea would have done on any recorded day, including days the gate never saw.</p>
        </div>
      ) : null}
      {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</p> : null}

      {result && s ? (
        <div className="grid gap-3">
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-border bg-card p-3"><div className="text-muted-foreground">Strategy / days</div><div className="text-sm font-semibold">{result.label} · {result.days.join(', ')}</div></div>
            <div className="rounded-lg border border-border bg-card p-3"><div className="text-muted-foreground">Signals judged</div><div className="text-sm font-semibold">{s.decisions}: {s.taken} taken, {s.skipped} skipped</div></div>
            <div className="rounded-lg border border-border bg-card p-3"><div className="text-muted-foreground">Trades</div><div className="text-sm font-semibold">{s.closedTrades}</div></div>
            {(['buy', 'sell'] as const).map((b) => <div key={b} className="rounded-lg border border-border bg-card p-3"><div className="uppercase text-muted-foreground">{b} book net</div><div className={`text-sm font-semibold tabular-nums ${colour(s.byBook[b].net)}`}>{inr(s.byBook[b].net)} <span className="font-normal text-muted-foreground">({s.byBook[b].n} trades)</span></div></div>)}
          </div>
          {result.baseline ? (
            <div className="rounded-lg border border-border bg-card p-2 text-xs">
              <div className="mb-1 font-semibold">Comparison on the same days</div>
              <table className="w-full tabular-nums"><thead className="text-muted-foreground"><tr><th className="text-left font-normal">Strategy</th><th className="text-right font-normal">Taken</th><th className="text-right font-normal">BUY net</th><th className="text-right font-normal">SELL net</th></tr></thead>
                <tbody>{[{ label: result.label, s: result.summary }, { label: `${result.baseline.label} (active)`, s: result.baseline.summary }].map((x) => <tr key={x.label} className="border-t border-border"><td>{x.label}</td><td className="text-right">{x.s.taken}</td><td className={`text-right ${colour(x.s.byBook.buy.net)}`}>{inr(x.s.byBook.buy.net)}</td><td className={`text-right ${colour(x.s.byBook.sell.net)}`}>{inr(x.s.byBook.sell.net)}</td></tr>)}</tbody></table>
              <p className="mt-1 text-muted-foreground">A difference on a few days is not evidence. The gate, on held-out days with at least 30 trades, is the test.</p>
            </div>
          ) : null}
          {result.notes.map((n) => <p key={n} className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs">{n}</p>)}

          <h2 className="text-sm font-semibold">Trades it would have taken ({result.trades.length})</h2>
          {result.trades.length ? result.trades.map((t) => <TradeCard key={t.decisionId} t={t} />) : <p className="text-xs text-muted-foreground">None. On these days no signal passed every rule, and no trade is always a valid result.</p>}

          <h2 className="text-sm font-semibold">Signals it skipped ({result.skipped.length})</h2>
          {Object.keys(result.skipCounts).length ? <div className="flex flex-wrap gap-2 text-xs">{Object.entries(result.skipCounts).map(([k, n]) => <span key={k} className="rounded bg-slate-500/15 px-2 py-1"><strong>{n}</strong> {BLOCKED[k] ?? k}</span>)}</div> : null}
          <div className="grid gap-1">{result.skipped.slice(0, 60).map((x) => <div key={x.decisionId} className="rounded-md border border-border px-3 py-1.5 text-xs"><span className="mr-2 tabular-nums text-muted-foreground">{short(x.underlying)} {istHhmm(x.ts)}</span><span className="mr-2 rounded bg-slate-500/15 px-1.5 py-0.5 font-semibold">{x.skipReason}</span>{x.reason}</div>)}</div>
          {result.skipped.length > 60 ? <p className="text-xs text-muted-foreground">Showing the first 60 of {result.skipped.length}.</p> : null}
        </div>
      ) : null}
      <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">Paper trading only. EOS/EOR are proxies. Results are not validated for live trading.</p>
    </div>
  );
}
