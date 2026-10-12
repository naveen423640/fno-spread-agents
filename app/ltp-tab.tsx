'use client';

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ExtLevel } from '@/lib/ltp/extensions';
import type { MethodSummary } from '@/lib/ltp/calibration';
import { CALIBRATION_LABELS } from '@/lib/ltp/calibration';
import type { LtpState } from '@/lib/ltp/state';
import type { CalibrationEntry } from '@/lib/ltp/store';
import { istDate, istHhmm } from '@/lib/ltp/time';
import { healthBadge } from '@/lib/ltp/view';

import { LtpChainTable } from '@/app/ltp-chain-table';

const LtpCharts = lazy(() => import('@/app/ltp-charts').then((m) => ({ default: m.LtpCharts })));

type CalibrationReply = { error?: string; entries?: CalibrationEntry[]; summary?: Record<string, MethodSummary> };
const REFRESH_MS = 60_000;
const UNDERLYING_OPTIONS = [
  { value: 'NSE:NIFTY50-INDEX', label: 'NIFTY 50' },
  { value: 'NSE:NIFTYBANK-INDEX', label: 'BANK NIFTY' },
  { value: 'BSE:SENSEX-INDEX', label: 'SENSEX' },
];
const BADGE_CLASS = { green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', red: 'bg-red-500/15 text-red-700 dark:text-red-400' };
const BADGE_TEXT = { green: 'Recording', amber: 'Recorder lagging', red: 'Recorder stopped' };

const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(v));
const clock = (ts: number | null) => (ts === null ? '–' : `${istHhmm(ts)} IST`);

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div><h2 className="text-sm font-semibold">{title}</h2>{note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}</div>
      {children}
    </section>
  );
}

const Proxy = ({ level }: { level: ExtLevel | null }) => (
  <span className="tabular-nums">{level ? `${num(level.value)}` : '–'}<span className="ml-1 text-[10px] text-muted-foreground">{level ? level.label.replace(/^[^(]*/, '') : ''}</span></span>
);

export function LtpTab() {
  const [underlying, setUnderlying] = useState(UNDERLYING_OPTIONS[0].value);
  const [method, setMethod] = useState('writer_breakeven');
  const [date, setDate] = useState('');
  const [state, setState] = useState<LtpState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [recordMsg, setRecordMsg] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ underlying, method });
      if (date) params.set('date', date);
      const res = await fetch(`/api/ltp/state?${params}`, { cache: 'no-store' });
      const body = (await res.json()) as LtpState | { error: string };
      if ('error' in body) throw new Error(body.error);
      setState(body); setError(null); setNow(Math.floor(Date.now() / 1000));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the LTP state.');
    } finally { setLoading(false); }
  }, [underlying, method, date]);

  // Asks the recorder route to store one snapshot per underlying now. The tab itself still reads only from the store.
  const recordNow = useCallback(async () => {
    try {
      const res = await fetch('/api/ltp/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const b = (await res.json()) as { error?: string; loginRequired?: boolean; skipped?: string; results?: { underlying: string; inserted: number; gap?: string; skipped?: string }[] };
      const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      if (res.status === 401) setRecordMsg(`${time}: connect FYERS first (login required).`);
      else if (b.error) setRecordMsg(`${time}: ${b.error}`);
      else if (b.skipped) setRecordMsg(`${time}: market is closed, nothing recorded (records 09:15 to 15:30 IST on trading days).`);
      else setRecordMsg(`${time}: ${(b.results ?? []).map((x) => `${x.underlying.slice(4, 9)} ${x.skipped ? 'already stored' : x.gap ? `gap (${x.gap})` : `${x.inserted} rows`}`).join(' · ')}`);
      void load();
    } catch { setRecordMsg('Could not reach the recorder.'); }
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const first = setTimeout(() => void recordNow(), 0);
    const id = setInterval(() => void recordNow(), REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [auto, recordNow]);

  // The tab reads only the stored snapshots (the recorder writes them); it never asks FYERS for anything.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);

  const badge = state ? healthBadge(state.health.lastSuccessTs === null ? null : now - state.health.lastSuccessTs) : 'red';
  const a = state && !state.empty && !state.analysis.empty && state.analysis.usable ? state.analysis : null;
  const methodLabel = state && !state.empty ? (state.methods.find((m) => m.id === state.selectedMethod)?.label ?? '') : '';

  const spot = state && !state.empty ? (a?.spot ?? (state.analysis.empty ? 0 : state.analysis.spot)) : 0;
  const name = UNDERLYING_OPTIONS.find((o) => o.value === underlying)?.label ?? '';
  const bias = a?.coa1.scenario.bias ?? '';
  const bannerClass = /^(Bull)/.test(bias) ? 'bg-emerald-600' : /^(Bear|Blood)/.test(bias) ? 'bg-red-600' : bias.startsWith('Not') ? 'bg-slate-500' : 'bg-blue-600';
  const lastShift = (side: 'support' | 'resistance') => a?.events.filter((e) => e.side === side).slice(-1)[0];
  const [panel, setPanel] = useState<'scenario' | 'lines' | 'weekly' | 'charts' | 'shifts' | 'calibration'>('scenario');
  const PANELS: [typeof panel, string][] = [['scenario', 'Scenario & levels'], ['lines', '9:20 lines'], ['weekly', 'Weekly range'], ['charts', 'Charts'], ['shifts', 'Level shifts'], ['calibration', 'Calibration']];

  const sidePill = (side: 'support' | 'resistance') => {
    if (!a) return null;
    const st = a.strength[side];
    const shift = lastShift(side);
    const label = st.status === 'strong' ? 'STRONG' : st.status === 'wtt' ? 'WEAK TOWARDS TOP (WTT)' : 'WEAK TOWARDS BOTTOM (WTB)';
    return (
      <div className={`rounded-md border px-3 py-1.5 text-xs ${side === 'support' ? 'border-emerald-600/50 bg-emerald-500/10' : 'border-red-600/50 bg-red-500/10'}`}>
        <div className="font-bold">{side === 'support' ? 'SUPPORT' : 'RESISTANCE'} {a.levels[side].strike} · <span className={st.status === 'strong' ? 'text-emerald-600' : 'text-amber-600'}>{label}</span></div>
        {shift ? <div className="text-[11px] text-muted-foreground">Shifted {shift.fromStrike} → {shift.toStrike} at {clock(shift.ts)} ({shift.metric})</div> : <div className="text-[11px] text-muted-foreground">Not shifted today</div>}
      </div>
    );
  };

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-3 px-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={underlying} onValueChange={(v) => v && setUnderlying(v)}>
          <SelectTrigger className="w-[130px]"><SelectValue>{name}</SelectValue></SelectTrigger>
          <SelectContent>{UNDERLYING_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" aria-label="Stored day" />
        {date ? <Button size="sm" variant="ghost" onClick={() => setDate('')}>Latest</Button> : null}
        <Select value={method} onValueChange={(v) => v && setMethod(v)}>
          <SelectTrigger className="w-[250px]"><SelectValue>{`EOS/EOR proxy: ${method.replace(/_/g, ' ')}`}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="writer_breakeven">EOS/EOR proxy: writer breakeven</SelectItem>
            <SelectItem value="time_value_only">EOS/EOR proxy: time value only</SelectItem>
          </SelectContent>
        </Select>
        {state && !state.empty ? <span className="text-sm"><span className="text-muted-foreground">Spot </span><strong className="tabular-nums">{num(spot)}</strong> <span className="text-muted-foreground">· Expiry </span>{a?.expiry ?? '–'}</span> : null}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-md px-2 py-1 font-medium ${BADGE_CLASS[badge]}`}>{BADGE_TEXT[badge]}{state ? ` · last ${clock(state.health.lastSuccessTs)}` : ''}</span>
          <Button size="sm" variant="outline" onClick={() => { setLoading(true); void load(); }} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>
          <Button size="sm" variant="outline" onClick={() => void recordNow()}>Record now</Button>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Auto-record</label>
        </span>
      </div>
      {recordMsg ? <p className="text-[11px] text-muted-foreground">{recordMsg}</p> : null}
      {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</p> : null}
      {state?.empty ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {state.reason === 'no_data_yet' ? 'No snapshots recorded yet. Press Record now, or tick Auto-record, while logged in to FYERS during market hours (09:15 to 15:30 IST).' : `No snapshots stored for ${state.date}.`}
        </p>
      ) : null}

      {state && !state.empty ? (
        <>
          {!a ? <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{state.analysis.empty ? '' : state.analysis.flags.join(' ')}</p> : (
            <>
              <div className={`rounded-md px-4 py-2 text-center text-sm font-bold uppercase tracking-wide text-white ${bannerClass}`}>
                {name} · {bias}
                <span className="ml-3 text-[11px] font-normal normal-case opacity-90">COA 1.0 scenario {a.coa1.scenario.number} · {state.date}{state.viewingStoredDay ? ' (stored day)' : ''} · snapshot {clock(state.snapshotTs)}</span>
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-border bg-card px-3 py-1.5"><span className="text-muted-foreground">Top reversal </span><strong>{a.coa1.top ? `${a.coa1.top.label.replace(/ \(.*/, '')} ${num(a.coa1.top.value)}` : '–'}</strong> <span className="text-muted-foreground">proxy · hits {a.coa1.hits.top.count}</span></div>
                <div className="rounded-md border border-border bg-card px-3 py-1.5"><span className="text-muted-foreground">Bottom reversal </span><strong>{a.coa1.bottom ? `${a.coa1.bottom.label.replace(/ \(.*/, '')} ${num(a.coa1.bottom.value)}` : '–'}</strong> <span className="text-muted-foreground">proxy · hits {a.coa1.hits.bottom.count}</span></div>
                <div className="rounded-md border border-border bg-card px-3 py-1.5"><span className="text-muted-foreground">Allowed </span>{a.coa1.scenario.allowed.join(', ') || 'none'}</div>
                <div className="rounded-md border border-border bg-card px-3 py-1.5"><span className="text-muted-foreground">COA 2.0 </span>{a.coa2.result.status === 'ok' ? `#${a.coa2.result.number} ${a.coa2.result.outcome}` : { outside_window: 'outside 09:45–14:30', not_on_first_hit: 'not on first hit', no_data: 'not enough OI history' }[a.coa2.result.status]}</div>
              </div>
              {a.flags.map((f) => <p key={f} className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs">{f}</p>)}

              <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="grid gap-2">
                  <div className="grid gap-2 sm:grid-cols-2">{sidePill('resistance')}{sidePill('support')}</div>
                  <LtpChainTable chain={state.chain} analysis={a} methodLabel={methodLabel} spot={spot} />
                </div>
                <Suspense fallback={<p className="text-xs text-muted-foreground">Loading chart…</p>}><LtpCharts analysis={a} lines0920={state.lines0920} only="spot" height={420} /></Suspense>
              </div>

              <div className="flex flex-wrap gap-1 border-b border-border">
                {PANELS.map(([id, label]) => <button key={id} type="button" onClick={() => setPanel(id)} className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${panel === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
              </div>

              {panel === 'scenario' ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">Levels</div>
                    <p>Imaginary line <strong className="tabular-nums">{a.levels.line.exact ? a.levels.line.low : `${a.levels.line.low} – ${a.levels.line.high}`}</strong></p>
                    {(['support', 'resistance'] as const).map((side) => <p key={side} className="text-xs capitalize">{side} {a.levels[side].strike} (decided by {a.levels[side].decidedBy}) · volume {num(a.strength[side].pct.volume, 1)}% · OI {num(a.strength[side].pct.oi, 1)}%</p>)}
                    <p className="mt-1 text-xs text-muted-foreground">{a.diversions.count} diversion strikes between support and resistance.</p>
                    <p className="text-xs">{a.soc ? `SOC ${a.soc.type}: ${a.soc.bias}, ${a.soc.minutes} min on ${a.soc.side} (from ${a.soc.from} proxy)` : 'No sustained-weakness (SOC) pattern.'}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">COA 2.0 (OI trend at the walls)</div>
                    <p className="text-xs">Call OI at resistance: {a.coa2.callTrend ?? 'unknown'} · Put OI at support: {a.coa2.putTrend ?? 'unknown'}</p>
                    <p className="mt-1">{a.coa2.result.status === 'ok' ? `Scenario ${a.coa2.result.number}: ${a.coa2.result.outcome}` : { outside_window: 'Outside the 09:45–14:30 window.', not_on_first_hit: 'Not read on the first hit of an extension.', no_data: 'Not enough OI history yet.' }[a.coa2.result.status]}</p>
                    <p className="mt-1 text-xs tabular-nums">Top <Proxy level={a.coa1.top} /> · hits {a.coa1.hits.top.count}{a.coa1.hits.top.label ? ` (${a.coa1.hits.top.label})` : ''}</p>
                    <p className="text-xs tabular-nums">Bottom <Proxy level={a.coa1.bottom} /> · hits {a.coa1.hits.bottom.count}{a.coa1.hits.bottom.label ? ` (${a.coa1.hits.bottom.label})` : ''}</p>
                  </div>
                  <div className="grid gap-1 rounded-lg border border-border bg-card p-3 text-xs">
                    {[a.extensions.eor, ...a.extensions.eorPlus, a.extensions.eos, ...a.extensions.eosMinus, ...(a.extensions.wtbPlus1 ? [a.extensions.wtbPlus1] : []), ...(a.extensions.wttMinus1 ? [a.extensions.wttMinus1] : [])].map((l) => (
                      <div key={l.label} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums">{num(l.value)} <span className="text-muted-foreground">@ {l.strike}</span></span></div>
                    ))}
                  </div>
                </div>
              ) : null}

              {panel === 'lines' ? (
                state.lines0920 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <p className="text-[11px] text-muted-foreground sm:col-span-2">Computed once from the first snapshot at or after 09:20 and never changed. Display only: nothing is traded. Entries and targets are proxies.</p>
                    {state.lines0920.delaySeconds > 120 ? <p className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs sm:col-span-2">Late: the first snapshot at or after 09:20 was {clock(state.lines0920.snapshotTs)} ({Math.round(state.lines0920.delaySeconds / 60)} min late), so these are not true 09:20 lines.</p> : null}
                    {(['risky', 'moderate'] as const).map((p) => (
                      <div key={p} className="rounded-lg border border-border bg-card p-3 text-xs">
                        <div className="mb-1 text-[11px] font-medium capitalize text-muted-foreground">{p} profile · from {clock(state.lines0920!.snapshotTs)}</div>
                        {state.lines0920!.profiles[p].length ? state.lines0920!.profiles[p].map((e) => (
                          <div key={e.label} className="flex flex-wrap justify-between gap-2 tabular-nums"><span>{e.side === 'short' ? 'Short' : 'Long'} at {e.label} (proxy)</span><span>entry {num(e.entry)} · stop {num(e.stop)} · target {num(e.target)} · risk {num(e.riskPoints)}</span></div>
                        )) : <span className="text-muted-foreground">No entry: a required reversal value is missing.</span>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">Not available yet (needs a snapshot at or after 09:20 IST).</p>
              ) : null}

              {panel === 'weekly' ? (
                state.weekly ? (
                  <div className="rounded-lg border border-border bg-card p-3 text-xs tabular-nums">
                    {state.weeklyWeekStart ? <p className="mb-1 text-[11px] text-muted-foreground">First stored day of this expiry, {state.weeklyWeekStart}: CMP ± 1, 2, 3 × (first OTM call + put LTP).</p> : null}
                    <p>S = {num(state.weekly.s)}{state.weekly.lateStart ? <span className="ml-2 rounded bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-400">late start: not from the 09:15 snapshot</span> : null}</p>
                    {([['L1', state.weekly.l1], ['L2', state.weekly.l2], ['L3', state.weekly.l3]] as const).map(([n, [lo, hi]]) => <p key={n}>{n}: {num(lo)} – {num(hi)}</p>)}
                  </div>
                ) : <p className="text-xs text-muted-foreground">Not available (needs first out-of-the-money call and put LTPs).</p>
              ) : null}

              {panel === 'charts' ? <Suspense fallback={<p className="text-xs text-muted-foreground">Loading charts…</p>}><LtpCharts analysis={a} lines0920={state.lines0920} only="rest" /></Suspense> : null}

              {panel === 'shifts' ? (
                a.events.length ? (
                  <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full text-xs tabular-nums"><tbody>
                      {[...a.events].reverse().map((e, i) => (
                        <tr key={`${e.ts}-${i}`} className="border-t border-border first:border-t-0"><td className="px-3 py-1">{clock(e.ts)}</td><td className="px-3 py-1 capitalize">{e.side}</td><td className="px-3 py-1">{e.metric}</td><td className="px-3 py-1">{e.fromStrike} → {e.toStrike}</td><td className="px-3 py-1 text-muted-foreground">{e.cause === 'second-became-highest' ? 'second-highest became highest' : 'other'}</td></tr>
                      ))}
                    </tbody></table>
                  </div>
                ) : <p className="text-xs text-muted-foreground">No level has shifted today.</p>
              ) : null}

              {panel === 'calibration' ? <Calibration underlying={underlying} date={state.date} /> : null}
            </>
          )}
        </>
      ) : null}

      <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">Rule-based reading of OI/volume; not validated; levels using EOS/EOR are proxies.</p>
    </div>
  );
}

// Log what the LTP Calculator website showed for EOS / EOR at a moment, to measure how far each proxy is from it.
function Calibration({ underlying, date }: { underlying: string; date: string }) {
  const [entries, setEntries] = useState<CalibrationEntry[]>([]);
  const [summary, setSummary] = useState<Record<string, MethodSummary>>({});
  const [time, setTime] = useState('');
  const [label, setLabel] = useState('EOS');
  const [actual, setActual] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const apply = (b: { entries: CalibrationEntry[]; summary: Record<string, MethodSummary> }) => { setEntries(b.entries); setSummary(b.summary); };
  useEffect(() => { fetch(`/api/ltp/calibration?underlying=${encodeURIComponent(underlying)}`, { cache: 'no-store' }).then((r) => r.json() as Promise<CalibrationReply>).then((b) => { if (b.entries) apply(b as { entries: CalibrationEntry[]; summary: Record<string, MethodSummary> }); }).catch(() => undefined); }, [underlying]);

  async function submit() {
    setMessage(null);
    const entryTs = Date.parse(`${date}T${time}:00+05:30`) / 1000;
    const res = await fetch('/api/ltp/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ underlying, entryTs, label, actual: Number(actual) }) });
    const body = (await res.json()) as CalibrationReply;
    if (!res.ok || !body.entries || !body.summary) { setMessage(body.error ?? 'Could not log that entry.'); return; }
    apply({ entries: body.entries, summary: body.summary }); setActual('');
  }

  return (
    <Section title="Calibration" note="The EOS/EOR calculation is not published. Type in what the LTP Calculator website showed at a time on the day above; the log shows how far each proxy is from it.">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-[120px]" aria-label="Time (IST)" />
        <Select value={label} onValueChange={(v) => v && setLabel(v)}><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger><SelectContent>{CALIBRATION_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select>
        <Input type="number" placeholder="Value shown" value={actual} onChange={(e) => setActual(e.target.value)} className="w-[140px]" />
        <Button size="sm" onClick={() => void submit()} disabled={!time || actual === ''}>Log</Button>
        {message ? <span className="text-xs text-red-600">{message}</span> : null}
      </div>
      {Object.keys(summary).length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-[11px] text-muted-foreground"><tr><th className="px-3 py-1 text-left">Proxy method</th><th className="px-3 py-1 text-right">Entries</th><th className="px-3 py-1 text-right">Mean abs error</th><th className="px-3 py-1 text-right">Median error</th><th className="px-3 py-1 text-right">Error in strike steps</th></tr></thead>
            <tbody>{Object.entries(summary).map(([m, s]) => <tr key={m} className="border-t border-border"><td className="px-3 py-1">{m.replace(/_/g, ' ')}</td><td className="px-3 py-1 text-right">{s.n}</td><td className="px-3 py-1 text-right">{num(s.meanAbsError)}</td><td className="px-3 py-1 text-right">{num(s.medianError)}</td><td className="px-3 py-1 text-right">{num(s.errorInSteps, 3)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="text-xs text-muted-foreground">No entries yet.</p>}
      {entries.length ? <p className="text-[11px] text-muted-foreground">{entries.length} entries logged; the latest was {istDate(entries[entries.length - 1].entryTs)} {istHhmm(entries[entries.length - 1].entryTs)} IST.</p> : null}
    </Section>
  );
}
