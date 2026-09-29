'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, Download, FlaskConical, Loader2, LockKeyhole, Play, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BacktestResultsDashboard, type BacktestReport } from './backtest-results-dashboard';

type CheckStatus = 'pass' | 'pending' | 'blocked';
type PreflightCheck = { label: string; status: CheckStatus; detail: string };
type PreflightPayload = { runId?: string; status: 'PASS' | 'WARNING' | 'FAIL' | 'RUNNING'; summary: string; canRun: boolean; checks: PreflightCheck[]; progressPercent?: number; error?: string };
type DailyRunPayload = { id?: string; status: 'EMPTY' | 'RUNNING' | 'COMPLETE' | 'FAIL'; progress_percent?: number; summary?: string; executable_trades?: number; expected_candidates?: number; result?: BacktestReport; configuration?: { slippagePerLeg?: number; roundTripCosts?: number } };

const outputTables = [
  ['1', 'Six-month overall results', 'Primary 80% exit, gross/net P&L and R-normalized metrics'],
  ['2', 'Bull Call vs Bear Put', 'Directional-neutral comparison with combined results'],
  ['3', 'R:R sensitivity', 'Six realized reward/risk bands from 1.50 to 3.00+'],
  ['4', 'Profit-target sensitivity', '50%, 60%, 70%, 80%, 90% and 100% targets'],
  ['5', 'Stop-loss controls', 'No-SL vs −50%, −75% and −100% MTM controls'],
  ['6', 'MAE recovery', 'Six adverse-excursion buckets and recovery timing'],
  ['7', '−100% MTM recovery', 'Bull, bear and combined worthless-to-recovery analysis'],
  ['8', 'Month-by-month', 'Six completed expiry cycles, split by spread direction'],
  ['9', 'Stock-level research', 'Expectancy and recovery only; no trade ranking'],
  ['10', 'Portfolio-level risk', 'Simultaneous exposure, MTM, drawdown and equal-risk view'],
];

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (status === 'blocked') return <AlertTriangle className="size-4 text-red-600" />;
  return <Clock3 className="size-4 text-amber-600" />;
}

export function BacktestPanel() {
  const [preflight, setPreflight] = useState<PreflightPayload | null>(null);
  const [checking, setChecking] = useState(false);
  const [dailyRun, setDailyRun] = useState<DailyRunPayload | null>(null);
  const [runningDaily, setRunningDaily] = useState(false);
  const [slippage, setSlippage] = useState('');
  const [costs, setCosts] = useState('');

  useEffect(() => {
    let active = true;
    async function loadLatestDailyRun() {
      try {
        const response = await fetch('/api/backtest/daily', { cache: 'no-store' });
        let payload = await response.json() as DailyRunPayload;
        if (payload.id && payload.status === 'COMPLETE') {
          const resultResponse = await fetch(`/api/backtest/daily/results?runId=${encodeURIComponent(payload.id)}`, { cache: 'no-store' });
          payload = await resultResponse.json() as DailyRunPayload;
        }
        if (active) {
          setDailyRun(payload);
          if (payload.configuration?.slippagePerLeg !== undefined) setSlippage(String(payload.configuration.slippagePerLeg));
          if (payload.configuration?.roundTripCosts !== undefined) setCosts(String(payload.configuration.roundTripCosts));
        }
      } catch {
        // Keep the workspace usable when no saved local run is available yet.
      }
    }
    void loadLatestDailyRun();
    return () => { active = false; };
  }, []);

  async function runPreflight() {
    setChecking(true);
    try {
      const response = await fetch('/api/backtest/preflight', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slippagePerLeg: Number(slippage), roundTripCosts: Number(costs) }),
      });
      let payload = await response.json() as PreflightPayload;
      setPreflight(payload);
      while (response.ok && payload.runId && payload.status === 'RUNNING') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusResponse = await fetch(`/api/backtest/preflight/status?runId=${encodeURIComponent(payload.runId)}`, { cache: 'no-store' });
        payload = await statusResponse.json() as PreflightPayload;
        setPreflight(payload);
      }
    } catch {
      setPreflight({ status: 'FAIL', canRun: false, summary: 'The data preflight could not be completed.', checks: [], error: 'Check the local FYERS connection and try again.' });
    } finally {
      setChecking(false);
    }
  }

  async function runDailyBacktest() {
    setRunningDaily(true);
    try {
      const response = await fetch('/api/backtest/daily', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slippagePerLeg: Number(slippage), roundTripCosts: Number(costs) }) });
      let payload = await response.json() as DailyRunPayload;
      setDailyRun(payload);
      while (response.ok && payload.id && payload.status === 'RUNNING') {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const statusResponse = await fetch(`/api/backtest/daily/status?runId=${encodeURIComponent(payload.id)}`, { cache: 'no-store' });
        payload = await statusResponse.json() as DailyRunPayload;
        setDailyRun(payload);
      }
      if (payload.id && payload.status === 'COMPLETE') {
        const resultResponse = await fetch(`/api/backtest/daily/results?runId=${encodeURIComponent(payload.id)}`, { cache: 'no-store' });
        setDailyRun(await resultResponse.json() as DailyRunPayload);
      }
    } catch {
      setDailyRun({ status: 'FAIL', summary: 'The daily-proxy run could not be completed.' });
    } finally {
      setRunningDaily(false);
    }
  }

  async function downloadDailyReport() {
    if (!dailyRun?.id) return;
    const response = await fetch(`/api/backtest/daily/results?runId=${encodeURIComponent(dailyRun.id)}`, { cache: 'no-store' });
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `daily-proxy-${dailyRun.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const assumptionsReady = Number(slippage) >= 0 && slippage !== '' && Number(costs) >= 0 && costs !== '';

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><FlaskConical className="size-4" />Research workspace</div>
        <h2 className="text-2xl font-semibold tracking-tight">6-Month Debit-Spread Historical Test</h2>
        <p className="mt-1 text-sm text-muted-foreground">Monthly top-50 liquid NSE F&amp;O stocks, tested independently for Bull Call and Bear Put spreads with no directional bias.</p>
      </div>
      <div className="flex gap-2"><Button variant="outline" disabled={dailyRun?.status !== 'COMPLETE'} onClick={downloadDailyReport}><Download />Export report</Button><Button disabled={!assumptionsReady || runningDaily} onClick={runDailyBacktest}>{runningDaily ? <Loader2 className="animate-spin" /> : <Play />}{runningDaily ? 'Running daily proxy…' : 'Start daily test'}</Button></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[['6', 'completed cycles'], ['50', 'stocks per month'], ['≈300', 'stock-months'], ['2×', 'bull + bear tests'], ['80%', 'primary target']].map(([value, label]) => <div key={label} className="market-stat"><span>{label}</span><strong>{value}</strong></div>)}
    </div>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
      <Card>
        <CardHeader className="border-b"><CardTitle className="flex items-center gap-2"><Database className="size-4" />Intraday data-quality preflight</CardTitle><p className="text-xs text-muted-foreground">The original 09:20 test remains locked by expired-option minute coverage. The approved DAILY_PROXY can run independently from verified NSE daily records.</p></CardHeader>
        <CardContent className="space-y-4">
          {!preflight ? <div className="rounded-lg border border-dashed p-6 text-center"><Database className="mx-auto mb-2 size-7 text-muted-foreground" /><p className="font-medium">Inspect FYERS historical coverage first</p><p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">Checks authorization, recent one-minute candles, expired option availability, quote fields and the monthly liquidity-ranking inputs.</p></div> : <>
            <div className={`rounded-lg border px-3 py-2 text-sm ${preflight.status === 'FAIL' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}><strong>{preflight.status === 'FAIL' ? 'FAIL: ' : preflight.status === 'RUNNING' ? `Running${preflight.progressPercent !== undefined ? ` (${preflight.progressPercent}%)` : ''}: ` : `${preflight.status}: `}</strong>{preflight.summary}</div>
            <div className="divide-y rounded-lg border">{preflight.checks.map((check) => <div key={check.label} className="flex gap-3 p-3"><StatusIcon status={check.status} /><div><div className="text-sm font-medium">{check.label}</div><div className="text-xs text-muted-foreground">{check.detail}</div></div></div>)}</div>
          </>}
          <Button onClick={runPreflight} disabled={checking || !assumptionsReady}>{checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{checking ? 'Checking FYERS data…' : 'Run intraday preflight'}</Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Execution assumptions</CardTitle><p className="text-xs text-muted-foreground">Required before a run; stored only for this session.</p></CardHeader>
          <CardContent className="grid gap-3">
            <label htmlFor="preflight-slippage" className="grid gap-1 text-xs text-muted-foreground">Slippage per option leg (₹)<Input id="preflight-slippage" type="number" min="0" step="0.05" value={slippage} onChange={(event) => setSlippage(event.target.value)} placeholder="Required" /></label>
            <label htmlFor="preflight-costs" className="grid gap-1 text-xs text-muted-foreground">Round-trip costs per spread (₹)<Input id="preflight-costs" type="number" min="0" step="0.05" value={costs} onChange={(event) => setCosts(event.target.value)} placeholder="Required" /></label>
            <p className="text-[11px] leading-relaxed text-muted-foreground">DAILY_PROXY uses actual traded daily opens/closes with the declared slippage on both legs at entry and exit. Gross and net P&amp;L remain separate.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Locked primary rules</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Entry</span><strong>Entry-day open proxy</strong></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Minimum actual R:R</span><strong>≥ 2.0</strong></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Stop loss</span><strong>None</strong></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Profit exit</span><strong>80% of max profit</strong></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Forced exit</span><strong>T−1 daily close</strong></div>
          </CardContent>
        </Card>
      </div>
    </div>

    <Tabs defaultValue="outputs">
      <TabsList className="h-auto flex-wrap"><TabsTrigger value="outputs">Dashboard</TabsTrigger><TabsTrigger value="monthly">Monthly &amp; direction</TabsTrigger><TabsTrigger value="controls">Sensitivity &amp; controls</TabsTrigger><TabsTrigger value="recovery">Recovery</TabsTrigger><TabsTrigger value="stocks">Stocks</TabsTrigger><TabsTrigger value="method">Methodology</TabsTrigger></TabsList>
      <TabsContent value="outputs">{dailyRun?.status === 'COMPLETE' && dailyRun.result ? <BacktestResultsDashboard report={dailyRun.result} view="overview" /> : <Card><CardHeader><CardTitle>Requested analysis outputs</CardTitle><p className="text-xs text-muted-foreground">{dailyRun?.summary ?? 'No values are shown until the historical run completes.'}</p></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Table</TableHead><TableHead>Output</TableHead><TableHead>Scope</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{outputTables.map(([number, title, scope]) => <TableRow key={number}><TableCell className="font-mono text-xs">{number}</TableCell><TableCell className="font-medium">{title}</TableCell><TableCell className="text-muted-foreground">{scope}</TableCell><TableCell><span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{dailyRun?.status === 'RUNNING' ? <Loader2 className="size-3 animate-spin" /> : dailyRun?.status === 'FAIL' ? <AlertTriangle className="size-3 text-red-600" /> : <LockKeyhole className="size-3" />}{dailyRun?.status === 'RUNNING' ? `${dailyRun.progress_percent ?? 0}%` : dailyRun?.status === 'FAIL' ? 'Failed' : 'Awaiting run'}</span></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}</TabsContent>
      <TabsContent value="monthly">{dailyRun?.result ? <BacktestResultsDashboard report={dailyRun.result} view="monthly" /> : <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Run the daily backtest to unlock monthly and direction results.</CardContent></Card>}</TabsContent>
      <TabsContent value="controls">{dailyRun?.result ? <BacktestResultsDashboard report={dailyRun.result} view="sensitivity" /> : <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Run the daily backtest to unlock sensitivity and stop-control comparisons.</CardContent></Card>}</TabsContent>
      <TabsContent value="recovery">{dailyRun?.result ? <BacktestResultsDashboard report={dailyRun.result} view="recovery" /> : <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Run the daily backtest to unlock MAE and recovery analysis.</CardContent></Card>}</TabsContent>
      <TabsContent value="stocks">{dailyRun?.result ? <BacktestResultsDashboard report={dailyRun.result} view="stocks" /> : <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Run the daily backtest to unlock stock-level research.</CardContent></Card>}</TabsContent>
      <TabsContent value="method"><Card><CardHeader><CardTitle>Bias controls and portfolio construction</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border p-4"><h3 className="font-medium">Monthly liquidity universe</h3><p className="mt-1 text-xs text-muted-foreground">Rank each month independently using only pre-entry turnover, F&amp;O and option-liquidity evidence. Exclude stocks not then eligible for F&amp;O.</p></div><div className="rounded-lg border p-4"><h3 className="font-medium">Capital-aware results</h3><p className="mt-1 text-xs text-muted-foreground">Report one spread per stock-month and equal-risk allocation normalized by R = maximum loss, including simultaneous portfolio exposure and drawdown.</p></div></CardContent></Card></TabsContent>
    </Tabs>

    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Research only. DAILY_PROXY uses entry-day opens and synchronized daily closes, not 09:20/15:15 execution. It does not recommend stocks or trades and will not interpolate missing option prices.</span></div>
  </div>;
}
