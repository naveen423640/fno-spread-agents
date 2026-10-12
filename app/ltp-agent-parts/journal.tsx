'use client';

import { useCallback, useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ClosedTrade } from '@/lib/ltp-agent/books';
import type { DecisionRecord } from '@/lib/ltp-agent/journal-store';
import type { PathPoint, Review } from '@/lib/ltp-agent/reviewer';
import { istHhmm } from '@/lib/ltp/time';
import { LineChart } from './line-chart';

type Row = { decisionId: string; ts: number; tradeDate: string; underlying: string; setup: string; direction: string; taken: boolean; skipReason: string | null; reason: string; version: string };
type Detail = { decision: DecisionRecord; outcomes: { book: string; netPnl: number; outcome: ClosedTrade }[]; review: Review | null; path: PathPoint[] };
const inr = (v: number) => `${v < 0 ? '-' : ''}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(v))}`;
const short = (u: string) => u.split(':')[1]?.replace('-INDEX', '') ?? u;

export function AgentJournal() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/ltp/agent/decisions?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const body = (await res.json()) as { decisions?: Row[]; error?: string };
      if (!res.ok || !body.decisions) throw new Error(body.error ?? 'Unable to read the journal.');
      setRows(body.decisions); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read the journal.'); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(q), 250); return () => clearTimeout(t); }, [q, load]);

  async function open(id: string) {
    const res = await fetch(`/api/ltp/agent/decisions?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.ok) setDetail((await res.json()) as Detail);
  }

  return (
    <div className="grid gap-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search decisions: a word in the reason, a rule (hit_number), NIFTY, taken, skipped, a date" className="max-w-xl" aria-label="Search the journal" />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {rows.length === 0 && !error ? <p className="text-sm text-muted-foreground">No decisions yet. They appear here as the agent judges each signal.</p> : null}
      <div className="grid gap-1.5">
        {rows.map((r) => (
          <button key={r.decisionId} type="button" onClick={() => void open(r.decisionId)} className="grid grid-cols-[auto_1fr] gap-x-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs hover:bg-muted/50">
            <span className="tabular-nums text-muted-foreground">{r.tradeDate.slice(5)} {istHhmm(r.ts)}</span>
            <span className="min-w-0">
              <span className={`mr-2 rounded px-1.5 py-0.5 font-semibold ${r.taken ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-slate-500/15 text-muted-foreground'}`}>{r.taken ? 'TAKEN' : `SKIPPED · ${r.skipReason}`}</span>
              <span className="font-semibold">{short(r.underlying)} {r.direction}</span> <span className="text-muted-foreground">· {r.setup} · v{r.version}</span>
              <span className="mt-0.5 block truncate text-muted-foreground">{r.reason}</span>
            </span>
          </button>
        ))}
      </div>
      <Dialog open={detail !== null} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-h-[92vh] w-[95vw] gap-3 overflow-y-auto sm:max-w-4xl">
          {detail ? <DetailView detail={detail} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailView({ detail }: { detail: Detail }) {
  const d = detail.decision;
  const spot = { title: 'Spot', color: '#3b82f6', points: detail.path.map((p) => ({ ts: p.ts, value: p.spot })) };
  const exp = d.expectation as { entry?: number; stop?: number; target?: number; plannedRiskPts?: number; rewardPts?: number; rr?: number };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{d.taken ? 'Taken' : 'Skipped'}: {short(d.underlying)} {d.direction} ({d.setup})</DialogTitle>
        <DialogDescription>{d.tradeDate} {istHhmm(d.ts)} IST · strategy v{d.strategyVersion} · decision written at that moment and never changed</DialogDescription>
      </DialogHeader>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{d.reason}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <section>
          <h3 className="mb-1 text-xs font-semibold">Rule trace</h3>
          <table className="w-full text-xs"><tbody>
            {d.trace.map((s) => (
              <tr key={s.rule} className="border-t border-border first:border-t-0 align-top">
                <td className={`py-1 pr-2 font-semibold ${s.passed ? 'text-emerald-600' : 'text-red-600'}`}>{s.passed ? 'pass' : 'FAIL'}</td>
                <td className="py-1 pr-2">{s.rule}</td>
                <td className="py-1 text-muted-foreground">{Object.entries(s.inputs).map(([k, v]) => `${k} ${v ?? '–'}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
        <section className="grid content-start gap-2 text-xs">
          <h3 className="text-xs font-semibold">Expectation at the time</h3>
          <p className="tabular-nums">Entry {exp.entry ?? '–'} · stop {exp.stop ?? '–'} · target {exp.target ?? '–'} · risk {exp.plannedRiskPts ?? '–'} pts · reward {exp.rewardPts ?? '–'} pts · R:R {exp.rr ?? '–'}</p>
          <h3 className="text-xs font-semibold">Outcome (written separately, after the trade)</h3>
          {detail.outcomes.length ? detail.outcomes.map((o) => (
            <p key={o.book} className="tabular-nums"><strong className="uppercase">{o.book}</strong> {inr(o.netPnl)} net ({o.outcome.exitReason}, {o.outcome.holdingMinutes} min, MAE {o.outcome.maeSpot.toFixed(0)} / MFE {o.outcome.mfeSpot.toFixed(0)} pts, fills: {o.outcome.fillQuality})</p>
          )) : <p className="text-muted-foreground">{d.taken ? 'Still open, or no outcome recorded.' : 'Not traded.'}</p>}
        </section>
      </div>
      {detail.path.length ? <section><h3 className="mb-1 text-xs font-semibold">Spot during the trade</h3><LineChart series={[spot]} height={180} /></section> : null}
      <section className="rounded-md border border-border p-3 text-xs">
        <h3 className="mb-1 font-semibold">Review (by the model, after the trade)</h3>
        {detail.review ? (
          <div className="grid gap-1">
            <p><strong>{detail.review.outcome_class.replace(/_/g, ' ')}</strong> · confidence {Math.round(detail.review.confidence * 100)}%{detail.review.mistake_tags.length ? ` · ${detail.review.mistake_tags.join(', ')}` : ''}</p>
            <p>{detail.review.what_happened}</p>
            <p className="text-muted-foreground">Lesson: {detail.review.lesson}</p>
          </div>
        ) : <p className="text-muted-foreground">Not reviewed yet. Reviews run after 15:35 IST once a trade has closed (needs ANTHROPIC_API_KEY).</p>}
      </section>
    </>
  );
}
