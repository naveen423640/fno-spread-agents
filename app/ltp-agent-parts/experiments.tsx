'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Experiment, BookGate } from '@/lib/ltp-agent/experiment-types';
import type { phaseOf } from '@/lib/ltp-agent/phase';
import type { VersionRow } from '@/lib/ltp-agent/versions';

type Payload = { activeVersion: string; phase: ReturnType<typeof phaseOf>; closedTrades: number; versions: VersionRow[]; experiments: Experiment[] };
const STATUS_CLASS: Record<string, string> = { proposed: 'bg-slate-500/15', running: 'bg-amber-500/15', awaiting_approval: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', rejected_by_gate: 'bg-red-500/15 text-red-700 dark:text-red-400', approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', rejected: 'bg-red-500/15 text-red-700 dark:text-red-400' };
const fmt = (v: number | string | null) => (v === null ? '–' : typeof v === 'number' ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v) : v);

function Gate({ book, g }: { book: string; g: BookGate }) {
  return (
    <div className="rounded-md border border-border p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-2"><strong className="uppercase">{book} book</strong><span className={`rounded px-1.5 py-0.5 font-semibold ${g.passed ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>{g.passed ? 'PASSED' : 'FAILED'}</span>{g.weakEvidence ? <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold">weak evidence: the interval includes 0</span> : null}</div>
      <table className="w-full"><tbody>
        {g.criteria.map((c) => <tr key={c.name} className="border-t border-border first:border-t-0"><td className={`py-0.5 pr-2 font-semibold ${c.passed ? 'text-emerald-600' : 'text-red-600'}`}>{c.passed ? 'pass' : 'fail'}</td><td className="pr-2">{c.name.replace(/_/g, ' ')}</td><td className="pr-2 tabular-nums">{fmt(c.value)}</td><td className="text-muted-foreground">{c.threshold}</td></tr>)}
      </tbody></table>
      <p className="mt-1 tabular-nums text-muted-foreground">Candidate: {g.candidate.n} trades, expectancy ₹{fmt(g.candidate.expectancy)}, profit factor {g.candidate.profitFactor === null ? 'unbounded' : fmt(g.candidate.profitFactor)}, max drawdown ₹{fmt(g.candidate.maxDrawdown)} · Current: {g.current.n} trades, expectancy ₹{fmt(g.current.expectancy)}, profit factor {g.current.profitFactor === null ? 'unbounded' : fmt(g.current.profitFactor)}, max drawdown ₹{fmt(g.current.maxDrawdown)}</p>
      <p className="tabular-nums text-muted-foreground">Expectancy difference ₹{fmt(g.expectancyDiff.mean)}, 90% interval [{fmt(g.expectancyDiff.lo90)}, {fmt(g.expectancyDiff.hi90)}] · better than {g.baselinePercentile === null ? 'n/a' : `${fmt(g.baselinePercentile)}%`} of random-entry runs</p>
    </div>
  );
}

export function AgentExperiments() {
  const [data, setData] = useState<Payload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch('/api/ltp/agent/experiments', { cache: 'no-store' });
    if (res.ok) setData((await res.json()) as Payload);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMessage(null);
    try {
      const res = await fetch('/api/ltp/agent/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reply = (await res.json()) as { error?: string; dropped?: { reason: string }[]; failure?: string };
      setMessage(!res.ok ? (reply.error ?? 'That did not work.') : reply.failure ? `The proposal run failed: ${reply.failure}` : `${ok}${reply.dropped?.length ? ` (${reply.dropped.length} proposals dropped: ${reply.dropped.map((d) => d.reason).join('; ')})` : ''}`);
      await load();
    } finally { setBusy(false); }
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const locked = !data.phase.unlocked;
  return (
    <div className="grid gap-4">
      {locked ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"><strong>Locked.</strong> Proposals and experiments unlock after 100 closed trades of version {data.activeVersion}. {data.phase.counter}.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => void act({ action: 'propose' }, 'Proposals saved.')}>Ask for proposals (at most 3)</Button>
          <span className="text-xs text-muted-foreground">Experiments tried so far: {data.experiments.length}. Every change is tested on days the model never sees; most will not pass.</span>
        </div>
      )}
      {message ? <p className="text-sm">{message}</p> : null}

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Versions</h3>
        {data.versions.map((v) => (
          <div key={v.version} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
            <strong>v{v.version}</strong>{v.active ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold">active</span> : null}
            <span className="min-w-0 flex-1 text-muted-foreground">{v.changelog}</span>
            {!v.active ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: 'rollback', version: v.version }, `Version ${v.version} is active again.`)}>Make active</Button> : null}
          </div>
        ))}
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Experiments</h3>
        {data.experiments.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : null}
        {[...data.experiments].reverse().map((e) => (
          <div key={e.id} className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2"><strong>{e.id}</strong><span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_CLASS[e.status] ?? ''}`}>{e.status.replace(/_/g, ' ')}</span><span className="text-muted-foreground">tested against v{e.baseVersion} · experiment {e.triedCount} tried so far{e.appliedVersion ? ` · became v${e.appliedVersion}` : ''}</span></div>
            <p>{e.hypothesis}</p>
            <p className="tabular-nums"><strong>Change:</strong> {Object.entries(e.diff).map(([k, v]) => `${k} = ${String(v)}`).join(', ')}</p>
            <p className="text-muted-foreground">Expected: {e.expectedEffect}{e.evidence.length ? ` · Evidence: ${e.evidence.join('; ')}` : ''}</p>
            {e.results ? <div className="grid gap-2 lg:grid-cols-2"><Gate book="buy" g={e.results.buy} /><Gate book="sell" g={e.results.sell} /></div> : null}
            {e.results ? <p className="text-muted-foreground">Tested on {e.results.holdoutDays.length} held-out days. Experiments tried so far: {e.results.triedCount}: the more that are tried, the likelier one passes by luck.</p> : null}
            <div className="flex gap-2">
              {e.status === 'proposed' ? <Button size="sm" disabled={busy || locked} onClick={() => void act({ action: 'run', id: e.id }, `${e.id} has been through the gate.`)}>Run the gate</Button> : null}
              {e.status === 'awaiting_approval' ? <Button size="sm" disabled={busy} onClick={() => void act({ action: 'approve', id: e.id }, `${e.id} approved: a new version is active.`)}>Approve</Button> : null}
              {e.status === 'awaiting_approval' || e.status === 'proposed' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: 'reject', id: e.id }, `${e.id} rejected.`)}>Reject</Button> : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
