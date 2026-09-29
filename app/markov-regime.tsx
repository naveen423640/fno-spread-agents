'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { marketSnapshot } from '@/lib/market-snapshot';
import type { RegimeErrorResponse, RegimeResponse } from '@/lib/regime/api-types';
import { REGIME_CONFIG } from '@/lib/regime/config';
import { HORIZONS, METHODS, STATES, WINDOWS, type Horizon, type LabelWindow, type Method, type State } from '@/lib/regime/types';
import { DISPLAY_ORDER, formatPercent, regimeBands, toDisplayMatrix } from '@/lib/regime/view';

const COLOR: Record<State, { text: string; band: string; pill: string }> = {
  Bull: { text: '#1a7f4b', band: '#cfe7da', pill: '#e3f2ea' },
  Bear: { text: '#b42318', band: '#f5d6d2', pill: '#fbe7e4' },
  Sideways: { text: '#475569', band: '#eceff3', pill: '#eef1f5' },
};
const METHOD_LABEL: Record<Method, string> = { vol: 'Vol-adjusted z ±1', fixed: 'Fixed ±5% (repo)' };
const CHART_SESSIONS = 250;
const ALERT = 'rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';

type Outcome = { kind: 'error'; message: string; code?: string } | { kind: 'data'; data: RegimeResponse };

function Pill({ label }: { label: State | null }) {
  if (!label) return <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold">Undefined</span>;
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: COLOR[label].pill, color: COLOR[label].text }}>{label}</span>;
}

function Choice<T extends string | number>({ legend, name, options, value, onChange, render }: { legend: string; name: string; options: readonly T[]; value: T; onChange: (value: T) => void; render: (option: T) => string }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      <div className="flex rounded-lg bg-muted p-0.5">
        {options.map((option) => (
          <label key={String(option)} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 ${option === value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`}>
            <input type="radio" className="sr-only" name={name} checked={option === value} onChange={() => onChange(option)} />
            {render(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="grid content-start gap-3 rounded-2xl border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

export function MarkovRegime() {
  const [ticker, setTicker] = useState('TCS');
  const [labelWindow, setLabelWindow] = useState<LabelWindow>(20);
  const [method, setMethod] = useState<Method>('vol');
  const [horizon, setHorizon] = useState<Horizon>(5);
  const [asOf, setAsOf] = useState('');
  const [matrixStep, setMatrixStep] = useState<'1' | 'n'>('1');
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const symbol = useMemo(() => marketSnapshot.find((stock) => stock.ticker === ticker.trim().toUpperCase())?.symbol ?? null, [ticker]);
  const requestKey = symbol ? `${symbol}|${labelWindow}|${method}|${horizon}|${asOf}` : null;

  useEffect(() => {
    if (!symbol || !requestKey) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ symbol, window: String(labelWindow), method, horizon: String(horizon) });
    if (asOf) query.set('asOf', asOf);
    fetch(`/api/regime?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as RegimeResponse | RegimeErrorResponse;
        const outcome: Outcome = !response.ok || 'error' in body
          ? { kind: 'error', message: 'error' in body ? body.error : 'Unable to load regime data.', code: 'code' in body ? body.code : undefined }
          : { kind: 'data', data: body };
        setResult({ key: requestKey, outcome });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, outcome: { kind: 'error', message: error instanceof Error ? error.message : 'Unable to load regime data.' } });
      });
    return () => controller.abort();
  }, [symbol, requestKey, labelWindow, method, horizon, asOf]);

  // A result only counts for the request that produced it, so a previous stock's numbers never show while a new one loads.
  const outcome: Outcome | 'loading' = !requestKey ? { kind: 'error', message: 'Choose a stock from the F&O universe.' } : result?.key === requestKey ? result.outcome : 'loading';

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">REGIME LAB</p>
        <h2 className="text-xl font-semibold">Markov Regime Detector</h2>
        <p className="text-sm text-muted-foreground">Labels each session Bull / Sideways / Bear from the rolling window, then estimates what tends to follow. Display and analysis only; it does not place orders.</p>
      </header>

      <section aria-label="Controls" className="flex flex-wrap items-end gap-6 rounded-2xl border bg-card p-4">
        <label className="grid gap-1 text-xs text-muted-foreground">F&O stock
          <input list="regime-stocks" value={ticker} onChange={(event) => setTicker(event.target.value)} className="h-10 w-44 rounded-lg border bg-background px-3 text-sm text-foreground" placeholder="Search ticker" />
          <datalist id="regime-stocks">{marketSnapshot.map((stock) => <option key={stock.symbol} value={stock.ticker}>{stock.name}</option>)}</datalist>
        </label>
        <Choice legend="Label window (sessions)" name="regime-window" options={WINDOWS} value={labelWindow} onChange={setLabelWindow} render={String} />
        <Choice legend="Labelling method" name="regime-method" options={METHODS} value={method} onChange={setMethod} render={(option) => METHOD_LABEL[option]} />
        <Choice legend="Forecast horizon" name="regime-horizon" options={HORIZONS} value={horizon} onChange={setHorizon} render={(option) => `n = ${option}`} />
        <label className="grid gap-1 text-xs text-muted-foreground">As of (close)
          <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm text-foreground" />
        </label>
      </section>

      {outcome === 'loading' && <output className="block text-sm text-muted-foreground">Loading daily prices…</output>}
      {outcome !== 'loading' && outcome.kind === 'error' && (
        <div role="alert" className={ALERT}>
          {outcome.message}{outcome.code === 'NO_TOKEN' || outcome.code === 'TOKEN_REJECTED' ? ' Use Connect FYERS on the heat map, then reload this tab.' : ''}
        </div>
      )}
      {outcome !== 'loading' && outcome.kind === 'data' && <RegimeResult data={outcome.data} matrixStep={matrixStep} onMatrixStep={setMatrixStep} />}
    </div>
  );
}

function RegimeResult({ data, matrixStep, onMatrixStep }: { data: RegimeResponse; matrixStep: '1' | 'n'; onMatrixStep: (step: '1' | 'n') => void }) {
  const { analysis: a, dataSource } = data;
  const thresholdLabel = a.method === 'vol' ? `z vs threshold ±${REGIME_CONFIG.volThreshold.toFixed(1)}` : `move vs threshold ±${(REGIME_CONFIG.fixedThreshold * 100).toFixed(0)}%`;
  const rows = useMemo(() => a.dates.map((date, i) => ({ date, close: a.closes[i], metric: a.metric[i] })).slice(-CHART_SESSIONS), [a]);
  const firstDate = rows[0]?.date ?? '';
  const lastDate = rows.at(-1)?.date ?? '';
  const bands = useMemo(() => regimeBands(a.dates, a.labels).filter((band) => band.end >= firstDate), [a, firstDate]);
  const windowStart = a.dates[Math.max(0, a.dates.length - 1 - a.window)] ?? firstDate;
  const threshold = a.method === 'vol' ? REGIME_CONFIG.volThreshold : REGIME_CONFIG.fixedThreshold;
  const displayMatrix = a.matrix ? toDisplayMatrix(matrixStep === 'n' && a.nStepMatrix ? a.nStepMatrix : a.matrix) : null;
  const displayCounts = a.counts ? toDisplayMatrix(a.counts) : null;
  const currentRow = a.current ? DISPLAY_ORDER.indexOf(a.current) : -1;
  const horizonKey = String(a.horizon) as '1' | '5' | '10';
  const chosenScore = a.score?.[horizonKey] ?? null;
  const chosenRow = a.forecast?.[horizonKey] ?? null;

  return (
    <>
      {dataSource.stale && dataSource.staleNote && <div role="alert" className={ALERT}>{dataSource.staleNote}</div>}
      {a.corporateActionFlags.length > 0 && (
        <div role="alert" className={ALERT}>
          Possible corporate action: a one-day move larger than {REGIME_CONFIG.corporateActionLogMove} in log terms on {a.corporateActionFlags.map((flag) => flag.date).join(', ')}. Labels around these dates may be distorted.
        </div>
      )}
      {a.gaps.length > 0 && <div role="alert" className={ALERT}>Missing sessions: gaps longer than {REGIME_CONFIG.gapCalendarDays} days before {a.gaps.map((gap) => gap.to).join(', ')}. Windows count sessions, so they span these gaps.</div>}
      <p className="text-xs text-muted-foreground">FYERS daily closes, last session {dataSource.lastCandleDate}. {dataSource.adjustmentNote}</p>

      <div className="grid gap-4 md:grid-cols-4">
        <Card title="Current regime" note={a.runLength ? `for ${a.runLength} sessions in a row` : undefined}>
          <div className="text-2xl font-semibold" style={{ color: a.current ? COLOR[a.current].text : undefined }}>{a.current ?? 'Undefined'}</div>
        </Card>
        <Card title={`${a.window}-session move`} note={a.metricNow === null ? undefined : `${a.method === 'vol' ? `z = ${a.metricNow >= 0 ? '+' : '−'}${Math.abs(a.metricNow).toFixed(2)}` : formatPercent(a.metricNow, 1, true)} ${thresholdLabel}`}>
          <div className="text-2xl font-semibold">{formatPercent(a.windowMove, 2, true)}</div>
        </Card>
        <Card title={`Signal score (n = ${a.horizon})`} note={chosenRow ? `P(Bull) ${chosenRow[2].toFixed(2)} · P(Bear) ${chosenRow[0].toFixed(2)}` : undefined}>
          <div className="text-2xl font-semibold">{a.insufficientHistory || chosenScore === null ? '—' : `${chosenScore >= 0 ? '+' : '−'}${Math.abs(chosenScore).toFixed(2)}`}</div>
        </Card>
        <Card title="Rule decision" note={`θ = ${a.theta.toFixed(2)} placeholder · fixed in development`}>
          <div className="text-2xl font-semibold">{a.decision ?? '—'}</div>
          {a.decisionNote && <p className="text-xs text-muted-foreground">{a.decisionNote}</p>}
        </Card>
      </div>

      <Card title="Price with regime ribbon" note={`Last ${Math.min(CHART_SESSIONS, a.dates.length)} sessions. Background colour = label on the ${a.window}-session window; outlined box = window behind today's label.`}>
        <ul className="flex gap-4 text-xs" aria-label="Regime colour key">
          {DISPLAY_ORDER.map((state) => <li key={state} className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border" style={{ background: COLOR[state].band }} />{state}</li>)}
        </ul>
        <figure className="h-72" aria-label={`Price chart with Bull, Sideways and Bear bands, currently ${a.current ?? 'undefined'}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              {bands.map((band) => <ReferenceArea key={`${band.start}-${band.label}`} x1={band.start < firstDate ? firstDate : band.start} x2={band.end} fill={COLOR[band.label].band} fillOpacity={0.7} ifOverflow="hidden" />)}
              <ReferenceArea x1={windowStart < firstDate ? firstDate : windowStart} x2={lastDate} stroke="#0b3f73" strokeWidth={1.5} fill="none" />
              <XAxis dataKey="date" minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={56} />
              <Tooltip />
              <Line dataKey="close" stroke="#0f172a" dot={false} strokeWidth={1.6} isAnimationActive={false} name="Close" />
            </LineChart>
          </ResponsiveContainer>
        </figure>
      </Card>

      <Card title={a.method === 'vol' ? `z-score of the ${a.window}-session move (vs prior ${REGIME_CONFIG.volLookback} sessions)` : `${a.window}-session simple return`}>
        <figure className="h-44" aria-label="Metric series with dashed threshold lines">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={56} />
              <Tooltip />
              <ReferenceLine y={threshold} stroke="#1a7f4b" strokeDasharray="5 4" label={{ value: `+${threshold} Bull`, fontSize: 11 }} />
              <ReferenceLine y={-threshold} stroke="#b42318" strokeDasharray="5 4" label={{ value: `−${threshold} Bear`, fontSize: 11 }} />
              <Line dataKey="metric" stroke="#0b3f73" dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} name={a.method === 'vol' ? 'z' : 'return'} />
            </LineChart>
          </ResponsiveContainer>
        </figure>
      </Card>

      {a.insufficientHistory ? (
        <output className="block rounded-xl border p-4 text-sm">Not enough history: {a.definedLabels} labelled sessions, minimum {REGIME_CONFIG.minLabels}. No matrix, forecast or decision is shown.</output>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Transition matrix" note={`Built from ${a.definedLabels} labelled sessions before the as-of date (minimum ${REGIME_CONFIG.minLabels}). Highlighted row = today's regime. Diagonal = how sticky each regime is.`}>
            <fieldset className="flex gap-2"><legend className="sr-only">Matrix horizon</legend>
              {(['1', 'n'] as const).map((step) => (
                <label key={step} className={`cursor-pointer rounded-md border px-3 py-1 text-xs has-[:focus-visible]:ring-2 ${matrixStep === step ? 'bg-muted font-semibold' : ''}`}>
                  <input type="radio" className="sr-only" name="matrix-step" checked={matrixStep === step} onChange={() => onMatrixStep(step)} />
                  {step === '1' ? '1-step' : `${a.horizon}-step`}
                </label>
              ))}
            </fieldset>
            {a.emptyRows.length > 0 && <p role="alert" className="text-xs text-amber-900">No observed transitions from {a.emptyRows.map((i) => STATES[i]).join(', ')}; that row is all zeros.</p>}
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Row = today, column = next session</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-1 text-left text-xs text-muted-foreground">From ↓ / To →</th>
                  {DISPLAY_ORDER.map((state) => <th key={state} scope="col" className="p-1 text-xs" style={{ color: COLOR[state].text }}>{state}</th>)}
                </tr>
              </thead>
              <tbody>
                {DISPLAY_ORDER.map((from, i) => (
                  <tr key={from} className={i === currentRow ? 'bg-muted/60' : ''} aria-current={i === currentRow ? 'true' : undefined}>
                    <th scope="row" className="p-1 text-left text-xs" style={{ color: COLOR[from].text }}>{from}{i === currentRow ? ' (today)' : ''}</th>
                    {DISPLAY_ORDER.map((to, j) => (
                      <td key={to} className="p-1 text-center">
                        <div className="font-medium">{formatPercent(displayMatrix![i][j], 1)}</div>
                        {matrixStep === '1' && <div className="text-[10px] text-muted-foreground">{displayCounts![i][j]} days</div>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Long-run mix" note="Stationary distribution vs the time actually spent in each state.">
            {[{ name: 'Long-run (stationary)', values: a.stationary }, { name: 'Time actually spent', values: a.timeShare }].map((row) => (
              <div key={row.name} className="grid gap-1">
                <div className="text-xs text-muted-foreground">{row.name}</div>
                {row.values ? (
                  <figure className="flex h-7 overflow-hidden rounded-md text-[11px] font-semibold" aria-label={`${row.name}: ${DISPLAY_ORDER.map((state) => `${state} ${formatPercent(row.values![STATES.indexOf(state)], 0)}`).join(', ')}`}>
                    {DISPLAY_ORDER.map((state) => {
                      const share = row.values![STATES.indexOf(state)];
                      return <div key={state} className="flex items-center justify-center" style={{ width: `${Math.max(0, share) * 100}%`, background: COLOR[state].band, color: COLOR[state].text }}>{share >= 0.08 ? `${state} ${formatPercent(share, 0)}` : ''}</div>;
                    })}
                  </figure>
                ) : <p className="text-xs">Unavailable</p>}
              </div>
            ))}
          </Card>

          <Card title={`Forecast path from ${a.current ?? 'undefined'}`} note="Probability of each state after k sessions (row of the matrix power).">
            {a.forecastPath ? (
              <figure className="h-52" aria-label="Forecast probabilities by number of sessions ahead">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={a.forecastPath.map((point) => ({ step: point.step, Bear: point.probs[0], Sideways: point.probs[1], Bull: point.probs[2] }))} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={40} />
                    <Tooltip formatter={(value) => formatPercent(Number(value), 1)} />
                    {DISPLAY_ORDER.map((state) => <Line key={state} dataKey={state} stroke={COLOR[state].text} dot={false} strokeWidth={2} isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </figure>
            ) : <p className="text-xs">Forecast unavailable{a.decisionNote ? `: ${a.decisionNote}` : '.'}</p>}
          </Card>

          <Card title="Recent regime changes">
            {a.recentChanges.length === 0 ? <p className="text-xs">No changes in the labelled history.</p> : (
              <ul className="grid gap-1 text-sm">
                {a.recentChanges.map((change) => (
                  <li key={change.date} className="flex items-center justify-between border-b py-1">
                    <span>{change.date}</span>
                    <span className="flex items-center gap-1.5"><Pill label={change.from} /> → <Pill label={change.to} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card title="Caveats">
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          <li>Labels come from the past window, so a label is a description, not a prediction. The matrix only counts how labels followed each other.</li>
          <li>The transition matrix assumes tomorrow depends only on today&apos;s label. Real markets do not guarantee that.</li>
          <li>θ = {a.theta.toFixed(2)} is a placeholder, fixed in development. Nothing here places or recommends an order.</li>
          <li>{dataSource.adjustmentNote}</li>
        </ul>
      </Card>
    </>
  );
}
