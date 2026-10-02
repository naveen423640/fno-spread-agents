'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, ChevronLeft, ChevronRight, Database, Loader2, LockKeyhole, Minus, Pencil, Play, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { marketSnapshot } from '@/lib/market-snapshot';
import { capitalAtRiskText, money } from '@/lib/money';
import { strategyLabRequest } from '@/lib/strategy-lab-request';
import { calculateRiskMetrics, type PayoffRiskMetrics } from '@/lib/strategy-payoff';

type StrategyKey = 'long-call' | 'long-put' | 'bull-call' | 'bear-put' | 'long-straddle' | 'long-strangle' | 'bull-put' | 'bear-call' | 'butterfly' | 'iron-condor';
type CurvePoint = { underlying: number; expiryPnl: number; selectedDayPnl: number };
type OiPoint = { strike: number; callOi: number; putOi: number; callOiChange: number; putOiChange: number };
type StrategyLeg = { symbol: string; optionType: 'CE' | 'PE'; strike: number; side: 1 | -1; quantity: number; entryPrice: number };
type StrategyDay = {
  date: string;
  underlyingClose: number;
  actualPnl: number;
  modelPnlAtSpot: number;
  curve: CurvePoint[];
  openInterest: OiPoint[];
  legMarks: Array<{ symbol: string; close: number; openInterest: number; changeInOpenInterest: number }>;
};
type StrategyResult = {
  ticker: string;
  requestedStartDate: string;
  entryDate: string;
  expiryDate: string;
  strategy: StrategyKey;
  strategyLabel: string;
  lotSize: number;
  entryUnderlying: number;
  entryNetPremium: number;
  capitalAtRiskLabel: string;
  maxProfit: number | null;
  maxLoss: number | null;
  rewardRisk: number | null;
  breakevens: number[];
  estimatedCapital: number | null;
  backendSync?: { ticker: string; expiryDate: string; sessionsStored: number; optionRowsStored: number; latestStoredDate: string; syncedAt: string; source: string };
  legs: StrategyLeg[];
  days: StrategyDay[];
  skippedSessions: number;
  source: string;
  methodology: string;
};
type StrategySetup = {
  ticker: string;
  requestedStartDate: string;
  entryDate: string;
  expiryDate: string;
  strategy: StrategyKey;
  strategyLabel: string;
  lotSize: number;
  entryUnderlying: number;
  availableStrikes: number[];
  contracts: Array<{ symbol: string; optionType: 'CE' | 'PE'; strike: number; price: number; openInterest: number }>;
  defaultLegs: StrategyLeg[];
};

const strategies: Array<{ key: StrategyKey; label: string; bias: 'Bullish' | 'Bearish' | 'Neutral'; shape: string }> = [
  { key: 'long-call', label: 'Buy Call', bias: 'Bullish', shape: '8,30 28,30 55,7' },
  { key: 'bull-call', label: 'Bull Call Spread', bias: 'Bullish', shape: '8,30 26,30 43,12 58,12' },
  { key: 'bull-put', label: 'Bull Put Spread', bias: 'Bullish', shape: '8,29 24,29 42,12 58,12' },
  { key: 'long-put', label: 'Buy Put', bias: 'Bearish', shape: '8,7 35,30 58,30' },
  { key: 'bear-put', label: 'Bear Put Spread', bias: 'Bearish', shape: '8,12 24,12 43,30 58,30' },
  { key: 'bear-call', label: 'Bear Call Spread', bias: 'Bearish', shape: '8,12 25,12 44,30 58,30' },
  { key: 'long-straddle', label: 'Long Straddle', bias: 'Neutral', shape: '8,8 33,30 58,8' },
  { key: 'long-strangle', label: 'Long Strangle', bias: 'Neutral', shape: '8,8 26,30 40,30 58,8' },
  { key: 'butterfly', label: 'Call Butterfly', bias: 'Neutral', shape: '8,30 22,30 33,8 45,30 58,30' },
  { key: 'iron-condor', label: 'Iron Condor', bias: 'Neutral', shape: '8,30 22,12 44,12 58,30' },
];

const payoffChartConfig = {
  expiryPnl: { label: 'On expiry', color: '#059669' },
  selectedDayPnl: { label: 'Selected day', color: '#2563eb' },
  putOi: { label: 'Put OI', color: '#22c55e' },
  callOi: { label: 'Call OI', color: '#ef4444' },
} satisfies ChartConfig;

const periodPnlChartConfig = {
  actualPnl: { label: 'Closing P&L', color: '#2563eb' },
  underlyingClose: { label: 'Underlying close', color: '#d97706' },
} satisfies ChartConfig;

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function compactNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000) return `${(value / 10_000_000).toFixed(2).replace(/\.00$/, '')}Cr`;
  if (absolute >= 100_000) return `${(value / 100_000).toFixed(1).replace(/\.0$/, '')}L`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return new Intl.NumberFormat('en-IN').format(value);
}

function RiskSummary({ metrics, compact = false }: { metrics: PayoffRiskMetrics; compact?: boolean }) {
  return <div className={compact ? 'grid grid-cols-2 gap-2' : 'grid gap-2 sm:grid-cols-2 xl:grid-cols-5'}>
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3"><span className="text-[11px] text-emerald-800">Max profit</span><strong className="mt-1 block text-base text-emerald-700">{metrics.maxProfit === null ? 'Unlimited' : money(metrics.maxProfit)}</strong></div>
    <div className="rounded-xl border border-red-200 bg-red-50/70 p-3"><span className="text-[11px] text-red-800">Max loss</span><strong className="mt-1 block text-base text-red-700">{metrics.maxLoss === null ? 'Unlimited' : money(metrics.maxLoss)}</strong></div>
    <div className="rounded-xl border p-3"><span className="text-[11px] text-muted-foreground">Reward / risk</span><strong className="mt-1 block text-base">{metrics.maxProfit === null && metrics.maxLoss !== null ? '∞' : metrics.rewardRisk === null ? '—' : `${metrics.rewardRisk.toFixed(2)}×`}</strong></div>
    <div className="rounded-xl border p-3"><span className="text-[11px] text-muted-foreground">Breakeven{metrics.breakevens.length === 1 ? '' : 's'}</span><strong className="mt-1 block text-sm">{metrics.breakevens.length ? metrics.breakevens.map((value) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}`).join(' · ') : '—'}</strong></div>
    <div className={`rounded-xl border p-3 ${compact ? 'col-span-2' : ''}`}><span className="text-[11px] text-muted-foreground">Est. capital at risk</span><strong className="mt-1 block text-base">{capitalAtRiskText(metrics.estimatedCapital)}</strong><span className="text-[10px] text-muted-foreground">Not broker margin</span></div>
  </div>;
}

function StrategyGlyph({ points }: { points: string }) {
  return <svg viewBox="0 0 66 38" className="h-10 w-16" aria-hidden="true"><path d="M4 30H62M10 4V34" stroke="currentColor" strokeOpacity=".18" fill="none" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

type TooltipRow = CurvePoint & Partial<OiPoint>;
function PayoffTooltip({ active, payload, date }: { active?: boolean; payload?: Array<{ payload?: TooltipRow }>; date: string }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="min-w-48 rounded-lg border border-border bg-background p-3 text-xs shadow-xl">
    <div className="mb-2 font-semibold">Underlying ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(point.underlying)}</div>
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
      <span className="text-blue-600">{displayDate(date)}</span><strong className={point.selectedDayPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(point.selectedDayPnl, true)}</strong>
      <span className="text-emerald-600">On expiry</span><strong className={point.expiryPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(point.expiryPnl, true)}</strong>
      {point.putOi !== undefined && <><span className="text-muted-foreground">Put OI</span><span>{compactNumber(point.putOi)}</span></>}
      {point.callOi !== undefined && <><span className="text-muted-foreground">Call OI</span><span>{compactNumber(point.callOi)}</span></>}
    </div>
  </div>;
}

function PeriodPnlTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: StrategyDay }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="rounded-lg border border-border bg-background p-3 text-xs shadow-xl">
    <div className="mb-1 font-semibold">{displayDate(point.date)}</div>
    <div className="flex min-w-44 items-center justify-between gap-5"><span className="text-muted-foreground">Closing P&amp;L</span><strong className={point.actualPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(point.actualPnl, true)}</strong></div>
    <div className="mt-1 flex items-center justify-between gap-5"><span className="text-muted-foreground">Underlying</span><span>₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(point.underlyingClose)}</span></div>
  </div>;
}

export function StrategyLab() {
  const [ticker, setTicker] = useState('SBIN');
  const [startDate, setStartDate] = useState(dateDaysAgo(7));
  const [strategy, setStrategy] = useState<StrategyKey>('bull-call');
  const [setup, setSetup] = useState<StrategySetup | null>(null);
  const [editableLegs, setEditableLegs] = useState<StrategyLeg[]>([]);
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [loading, setLoading] = useState<'setup' | 'build' | 'sync' | null>(null);
  const [error, setError] = useState('');
  const selectedStrategy = strategies.find((item) => item.key === strategy)!;
  const selectedDay = result?.days[dayIndex] ?? null;

  async function prepare(nextStrategy = strategy) {
    setStrategy(nextStrategy);
    setLoading('setup');
    setError('');
    setSetup(null);
    setEditableLegs([]);
    setResult(null);
    try {
      const response = await fetch('/api/strategy-lab', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup', ticker, startDate, strategy: nextStrategy }),
      });
      const payload = await response.json() as StrategySetup & { error?: string };
      if (!response.ok || !payload.defaultLegs) throw new Error(payload.error ?? 'Unable to load editable strategy legs.');
      setSetup(payload);
      setEditableLegs(payload.defaultLegs);
      setDayIndex(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load editable strategy legs.');
    } finally {
      setLoading(null);
    }
  }

  async function build(syncBackend = false) {
    const request = strategyLabRequest(syncBackend ? 'sync' : 'build', { ticker, startDate, strategy, legs: editableLegs });
    if (!request) return;
    setLoading(syncBackend ? 'sync' : 'build');
    setError('');
    try {
      const response = await fetch('/api/strategy-lab', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = await response.json() as StrategyResult & { error?: string };
      if (!response.ok || !payload.days) throw new Error(payload.error ?? 'Unable to build the options payoff test.');
      setResult(payload);
      setDayIndex(syncBackend ? Math.max(0, payload.days.length - 1) : 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to build the options payoff test.');
    } finally {
      setLoading(null);
    }
  }

  function changeInputs(update: () => void) {
    update();
    setSetup(null);
    setEditableLegs([]);
    setResult(null);
    setError('');
    setDayIndex(0);
  }

  function setLegStrike(legIndex: number, strike: number) {
    if (!setup || result) return;
    setEditableLegs((current) => current.map((leg, index) => {
      if (index !== legIndex) return leg;
      const contract = setup.contracts.find((item) => item.optionType === leg.optionType && item.strike === strike);
      return contract ? { ...leg, strike, symbol: contract.symbol, entryPrice: contract.price } : leg;
    }));
  }

  function shiftLegStrike(legIndex: number, direction: -1 | 1) {
    if (!setup || result) return;
    const leg = editableLegs[legIndex];
    const strikes = [...new Set(setup.contracts.filter((contract) => contract.optionType === leg.optionType).map((contract) => contract.strike))].sort((a, b) => a - b);
    const currentIndex = strikes.indexOf(leg.strike);
    const nextStrike = strikes[Math.max(0, Math.min(strikes.length - 1, currentIndex + direction))];
    if (nextStrike !== undefined) setLegStrike(legIndex, nextStrike);
  }

  function setLegQuantity(legIndex: number, quantity: number) {
    if (result || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return;
    setEditableLegs((current) => current.map((leg, index) => index === legIndex ? { ...leg, quantity } : leg));
  }

  const previewMetrics = useMemo(() => setup && editableLegs.length ? calculateRiskMetrics(editableLegs, setup.lotSize) : null, [editableLegs, setup]);

  const chartData = useMemo(() => {
    if (!selectedDay) return [];
    const oi = new Map(selectedDay.openInterest.map((point) => [point.strike, point]));
    return selectedDay.curve.map((point) => ({ ...point, ...oi.get(point.underlying) }));
  }, [selectedDay]);
  const lastAvailableDate = result?.days.at(-1)?.date;
  const expiryPending = Boolean(result && lastAvailableDate && lastAvailableDate < result.expiryDate);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><TrendingUp className="size-4" />Options strategy lab</div>
        <h2 className="text-2xl font-semibold tracking-tight">Daily Payoff Backtest</h2>
        <p className="mt-1 text-sm text-muted-foreground">Select a stock, start date and ready-made strategy. Move through actual daily marks while Call/Put OI stays aligned to the payoff strikes.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline"><Database />Official NSE daily records</Badge><Button size="sm" variant="outline" disabled={Boolean(loading)} onClick={() => void build(true)} title="Download the latest NSE daily reports for the selected stock, start date and strategy into the backend, then rebuild the test">{loading === 'sync' ? <Loader2 className="animate-spin" /> : <RefreshCw />}{loading === 'sync' ? 'Updating backend…' : 'Update backend NSE data'}</Button></div>
    </div>

    <div className="grid items-start gap-4 xl:grid-cols-[520px_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>Build strategy</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">F&amp;O stock<Select value={ticker} onValueChange={(value) => value && changeInputs(() => setTicker(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{marketSnapshot.map((stock) => <SelectItem key={stock.ticker} value={stock.ticker}>{stock.ticker}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Start date<Input type="date" max={new Date().toISOString().slice(0, 10)} value={startDate} onChange={(event) => changeInputs(() => setStartDate(event.target.value))} /></label>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Ready-made strategies</div>
            <div className="grid grid-cols-2 gap-2">
              {strategies.map((item) => <button key={item.key} type="button" disabled={Boolean(loading) || Boolean(result)} onClick={() => void prepare(item.key)} aria-pressed={strategy === item.key} className={`flex min-h-24 items-center gap-2 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${strategy === item.key ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary/30' : 'hover:bg-muted/50'}`}><StrategyGlyph points={item.shape} /><span><strong className="block text-xs">{item.label}</strong><span className="text-[10px] text-muted-foreground">{item.bias}</span></span></button>)}
            </div>
          </div>

          {setup && <div className="overflow-x-auto rounded-xl border border-border">
            <div className="min-w-[480px]">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2"><div><strong className="text-xs">{setup.strategyLabel}</strong><span className="ml-2 text-[10px] text-muted-foreground">Entry {displayDate(setup.entryDate)} · expiry {displayDate(setup.expiryDate)}</span></div>{result && <Badge variant="outline"><LockKeyhole />Locked</Badge>}</div>
              <div className="grid grid-cols-[42px_minmax(160px,1fr)_42px_78px_62px] gap-1 border-b px-2 py-1.5 text-[10px] text-muted-foreground"><span>B/S</span><span>Strike</span><span>Type</span><span>Lots</span><span className="text-right">Price</span></div>
              <div className="divide-y">{editableLegs.map((leg, legIndex) => {
                const strikes = [...new Set(setup.contracts.filter((contract) => contract.optionType === leg.optionType).map((contract) => contract.strike))].sort((a, b) => a - b);
                return <div key={`${leg.optionType}-${legIndex}`} className="grid grid-cols-[42px_minmax(160px,1fr)_42px_78px_62px] items-center gap-1 px-2 py-2 text-xs">
                  <Badge className="px-1.5" variant={leg.side === 1 ? 'default' : 'destructive'}>{leg.side === 1 ? 'B' : 'S'}</Badge>
                  <div className="flex items-center gap-1"><Button size="icon-xs" variant="outline" disabled={Boolean(result) || strikes.indexOf(leg.strike) <= 0} onClick={() => shiftLegStrike(legIndex, -1)} aria-label={`Lower strike for leg ${legIndex + 1}`}><Minus /></Button><Select disabled={Boolean(result)} value={String(leg.strike)} onValueChange={(value) => value && setLegStrike(legIndex, Number(value))}><SelectTrigger className="h-7 min-w-0 flex-1 px-2"><SelectValue /></SelectTrigger><SelectContent>{strikes.map((strike) => <SelectItem key={strike} value={String(strike)}>{strike}</SelectItem>)}</SelectContent></Select><Button size="icon-xs" variant="outline" disabled={Boolean(result) || strikes.indexOf(leg.strike) >= strikes.length - 1} onClick={() => shiftLegStrike(legIndex, 1)} aria-label={`Higher strike for leg ${legIndex + 1}`}><Plus /></Button></div>
                  <span>{leg.optionType}</span><Select disabled={Boolean(result)} value={String(leg.quantity)} onValueChange={(value) => value && setLegQuantity(legIndex, Number(value))}><SelectTrigger className="h-7 px-2"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 20 }, (_, index) => index + 1).map((quantity) => <SelectItem key={quantity} value={String(quantity)}>{quantity}</SelectItem>)}</SelectContent></Select><span className="text-right tabular-nums">₹{leg.entryPrice}</span>
                </div>;
              })}</div>
            </div>
          </div>}

          {setup && !result && previewMetrics && <div className="space-y-2"><div><strong className="text-xs">Profit summary before build</strong><p className="text-[10px] text-muted-foreground">Updates immediately when you change a strike or lot count.</p></div><RiskSummary metrics={previewMetrics} compact /></div>}

          {result ? <Button className="w-full" variant="outline" onClick={() => { setResult(null); setDayIndex(0); }}><Pencil />Edit strikes</Button> : setup ? <Button className="w-full" disabled={Boolean(loading)} onClick={() => void build()}>{loading === 'build' ? <Loader2 className="animate-spin" /> : <Play />}{loading === 'build' ? 'Building daily payoff…' : `Build ${selectedStrategy.label}`} {loading !== 'build' && <ArrowRight />}</Button> : <Button className="w-full" disabled={Boolean(loading) || !ticker || !startDate} onClick={() => void prepare()}>{loading === 'setup' ? <Loader2 className="animate-spin" /> : <Play />}{loading === 'setup' ? 'Loading nearest expiry…' : 'Load editable strikes'} {loading !== 'setup' && <ArrowRight />}</Button>}
          <p className="text-[11px] leading-relaxed text-muted-foreground">A weekend or exchange holiday moves entry to the next available trading day. Prices and OI are never forward-filled.</p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {loading === 'build' || loading === 'sync' ? <Card className="min-h-[610px]"><CardContent className="flex min-h-[600px] items-center justify-center"><div className="text-center"><Loader2 className="mx-auto mb-3 size-9 animate-spin text-primary" /><h3 className="font-medium">{loading === 'sync' ? 'Updating backend NSE data' : 'Loading the expiry cycle'}</h3><p className="mt-1 text-xs text-muted-foreground">{loading === 'sync' ? 'Downloading published NSE option reports, storing them in the backend, then rebuilding this payoff test.' : 'Reading stored backend reports and matching every option leg.'}</p></div></CardContent></Card> : error ? <Card className="border-red-200"><CardContent className="flex min-h-48 items-start gap-3 p-6 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" /><div><h3 className="font-semibold text-red-700">Backtest could not be built</h3><p className="mt-1 text-muted-foreground">{error}</p><p className="mt-3 text-xs text-muted-foreground">For a completed historical cycle, choose a date when the stock had listed options. For the current cycle, only sessions already published by NSE can be displayed.</p></div></CardContent></Card> : result && selectedDay ? <>
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle className="flex items-center gap-2"><BarChart3 className="size-4" />{result.ticker} · {result.strategyLabel}</CardTitle><p className="mt-1 text-xs text-muted-foreground">Entry {displayDate(result.entryDate)} · nearest expiry {displayDate(result.expiryDate)} · lot {result.lotSize}</p></div>
                <div className="flex flex-wrap gap-2"><Badge variant="secondary">{selectedDay.date === result.expiryDate ? 'Expiry' : `${Math.max(0, Math.ceil((new Date(`${result.expiryDate}T12:00:00`).getTime() - new Date(`${selectedDay.date}T12:00:00`).getTime()) / 86_400_000))} days to expiry`}</Badge>{expiryPending && <Badge variant="outline">Available through {displayDate(lastAvailableDate!)}</Badge>}{result.backendSync && <Badge variant="outline">Backend updated through {displayDate(result.backendSync.latestStoredDate)} · {result.backendSync.sessionsStored} sessions</Badge>}</div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <RiskSummary metrics={result} />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="market-stat"><span>Selected-day P&amp;L</span><strong className={selectedDay.actualPnl >= 0 ? '!text-emerald-600' : '!text-red-600'}>{money(selectedDay.actualPnl, true)}</strong></div>
                <div className="market-stat"><span>Underlying close</span><strong>₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(selectedDay.underlyingClose)}</strong></div>
                <div className="market-stat"><span>{result.entryNetPremium >= 0 ? 'Entry debit' : 'Entry credit'}</span><strong>₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(result.entryNetPremium))}</strong></div>
                <div className="market-stat"><span>Entry notional</span><strong>{money(Math.abs(result.entryNetPremium) * result.lotSize)}</strong></div>
              </div>

              <div className="rounded-xl border border-border p-3">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-3 px-1">
                  <div><h3 className="text-sm font-semibold">Payoff and open interest</h3><p className="text-[11px] text-muted-foreground">Modelled selected-day curve from observed closes · exact expiry payoff · end-of-day OI</p></div>
                  <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1"><i className="h-0.5 w-4 bg-blue-600" />Selected day</span><span className="flex items-center gap-1"><i className="h-0.5 w-4 bg-emerald-600" />Expiry</span><span className="flex items-center gap-1"><i className="size-2.5 bg-green-400/50" />Put OI</span><span className="flex items-center gap-1"><i className="size-2.5 bg-red-400/50" />Call OI</span></div>
                </div>
                <ChartContainer config={payoffChartConfig} className="h-[440px] w-full aspect-auto" initialDimension={{ width: 900, height: 440 }}>
                  <ComposedChart data={chartData} margin={{ top: 28, right: 10, bottom: 10, left: 8 }}>
                    <defs><linearGradient id="selected-payoff-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} />
                    <XAxis type="number" dataKey="underlying" domain={['dataMin', 'dataMax']} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value))} />
                    <YAxis yAxisId="pnl" tickLine={false} axisLine={false} width={66} tick={{ fontSize: 10 }} tickFormatter={(value) => money(Number(value))} />
                    <YAxis yAxisId="oi" orientation="right" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 10 }} tickFormatter={(value) => compactNumber(Number(value))} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke="#64748b" strokeWidth={1.2} />
                    <ReferenceLine yAxisId="pnl" x={selectedDay.underlyingClose} stroke="#0f172a" strokeDasharray="5 4" label={{ value: `Close ₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(selectedDay.underlyingClose)}`, position: 'insideTop', fill: '#0f172a', fontSize: 10 }} />
                    <Bar yAxisId="oi" dataKey="putOi" fill="#22c55e" fillOpacity={0.28} barSize={8} />
                    <Bar yAxisId="oi" dataKey="callOi" fill="#ef4444" fillOpacity={0.26} barSize={8} />
                    <Area yAxisId="pnl" type="monotone" dataKey="selectedDayPnl" stroke="#2563eb" strokeWidth={2.4} fill="url(#selected-payoff-fill)" dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="pnl" type="linear" dataKey="expiryPnl" stroke="#059669" strokeWidth={2.1} dot={false} />
                    <ReferenceDot yAxisId="pnl" x={selectedDay.underlyingClose} y={selectedDay.actualPnl} r={5} fill={selectedDay.actualPnl >= 0 ? '#059669' : '#dc2626'} stroke="white" strokeWidth={2} />
                    <ChartTooltip content={<PayoffTooltip date={selectedDay.date} />} />
                  </ComposedChart>
                </ChartContainer>
              </div>

              <div className="grid items-center gap-3 rounded-xl border border-border bg-muted/25 p-3 sm:grid-cols-[auto_1fr_auto]">
                <Button size="icon" variant="outline" aria-label="Previous trading day" disabled={dayIndex === 0} onClick={() => setDayIndex((current) => Math.max(0, current - 1))}><ChevronLeft /></Button>
                <div className="space-y-2"><div className="flex items-center justify-between text-xs"><strong>{displayDate(selectedDay.date)}</strong><span className="text-muted-foreground">Trading day {dayIndex + 1} of {result.days.length}</span></div><Slider min={0} max={Math.max(result.days.length - 1, 0)} step={1} value={[dayIndex]} onValueChange={(value) => setDayIndex(Array.isArray(value) ? Number(value[0] ?? 0) : Number(value))} /></div>
                <Button size="icon" variant="outline" aria-label="Next trading day" disabled={dayIndex === result.days.length - 1} onClick={() => setDayIndex((current) => Math.min(result.days.length - 1, current + 1))}><ChevronRight /></Button>
              </div>

              <div className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2 px-1"><div><h3 className="text-sm font-semibold">P&amp;L and underlying price</h3><p className="text-[11px] text-muted-foreground">Daily strategy mark-to-market on the left scale · underlying close on the right scale.</p></div><div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><i className="h-0.5 w-4 bg-blue-600" />P&amp;L</span><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><i className="h-0.5 w-4 bg-amber-600" />Underlying</span><Badge variant={selectedDay.actualPnl >= 0 ? 'default' : 'destructive'}>{displayDate(selectedDay.date)} · {money(selectedDay.actualPnl, true)}</Badge></div></div>
                <ChartContainer config={periodPnlChartConfig} className="h-[250px] w-full aspect-auto" initialDimension={{ width: 900, height: 250 }}>
                  <ComposedChart data={result.days} margin={{ top: 18, right: 12, bottom: 4, left: 8 }}>
                    <defs><linearGradient id="period-pnl-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.24} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} tick={{ fontSize: 10 }} tickFormatter={(value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} />
                    <YAxis yAxisId="pnl" tickLine={false} axisLine={false} width={66} tick={{ fontSize: 10 }} tickFormatter={(value) => money(Number(value))} />
                    <YAxis yAxisId="price" orientation="right" domain={['dataMin', 'dataMax']} allowDataOverflow tickLine={false} axisLine={false} width={58} tick={{ fontSize: 10 }} tickFormatter={(value) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value))}`} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke="#64748b" strokeWidth={1.2} />
                    <ReferenceLine yAxisId="pnl" x={selectedDay.date} stroke="#0f172a" strokeDasharray="5 4" />
                    <Area yAxisId="pnl" type="monotone" dataKey="actualPnl" stroke="#2563eb" strokeWidth={2.4} fill="url(#period-pnl-fill)" dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="price" type="monotone" dataKey="underlyingClose" stroke="#d97706" strokeWidth={2.1} dot={false} activeDot={{ r: 4 }} />
                    <ReferenceDot yAxisId="pnl" x={selectedDay.date} y={selectedDay.actualPnl} r={5} fill={selectedDay.actualPnl >= 0 ? '#059669' : '#dc2626'} stroke="white" strokeWidth={2} />
                    <ReferenceDot yAxisId="price" x={selectedDay.date} y={selectedDay.underlyingClose} r={4} fill="#d97706" stroke="white" strokeWidth={2} />
                    <ChartTooltip content={<PeriodPnlTooltip />} />
                  </ComposedChart>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Strategy legs on {displayDate(selectedDay.date)}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{result.legs.map((leg, index) => { const mark = selectedDay.legMarks[index]; return <div key={`${leg.optionType}-${leg.strike}-${index}`} className="rounded-lg border p-3 text-xs"><div className="mb-2 flex items-center justify-between"><Badge variant={leg.side === 1 ? 'default' : 'destructive'}>{leg.side === 1 ? 'BUY' : 'SELL'} {leg.quantity}×</Badge><strong>{leg.strike} {leg.optionType}</strong></div><div className="grid grid-cols-2 gap-y-1"><span className="text-muted-foreground">Entry</span><span className="text-right">₹{leg.entryPrice}</span><span className="text-muted-foreground">Day close</span><span className="text-right">₹{mark?.close ?? '—'}</span><span className="text-muted-foreground">OI</span><span className="text-right">{compactNumber(mark?.openInterest ?? 0)}</span></div></div>; })}</div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{result.methodology}{result.skippedSessions ? ` ${result.skippedSessions} session(s) were skipped because at least one leg had no traded close.` : ''}</p>
            </CardContent>
          </Card>
        </> : <Card className="min-h-[610px]"><CardHeader className="border-b"><CardTitle className="flex items-center gap-2"><BarChart3 className="size-4" />Payoff graph</CardTitle><p className="text-xs text-muted-foreground">Expiry payoff, selected-day mark-to-market and Call/Put open interest share the same strike axis.</p></CardHeader><CardContent className="flex min-h-[500px] items-center justify-center text-center"><div className="max-w-md"><CalendarDays className="mx-auto mb-3 size-9 text-muted-foreground" /><h3 className="font-medium">Choose the backtest inputs</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Click any ready-made strategy or use Build. The nearest expiry is discovered automatically, then the arrows move across its available trading days.</p></div></CardContent></Card>}
      </div>
    </div>

    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Research view only. Daily P&amp;L uses official closing prices, not intraday execution. The blue curve is a Black–Scholes mark-to-market curve calibrated to each leg’s observed daily close; the green expiry curve is exact intrinsic payoff.</span></div>
  </div>;
}
