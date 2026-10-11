'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, BarChart3, CalendarDays, FlaskConical, LayoutGrid, Layers, Waves, LineChart, Link2, Radio, RefreshCw, Search, SlidersHorizontal, ScanSearch, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AgentRunPanel } from '@/app/agent-run-panel';
import { BacktestPanel } from '@/app/backtest-panel';
import { HeatmapAssistant } from '@/app/heatmap-assistant';
import { MarkovRegime } from '@/app/markov-regime';
import { BoardTab } from '@/app/board-tab';
import { VwapBacktestTab } from '@/app/vwap-backtest-tab';
import { VwapTab } from '@/app/vwap-tab';
import { ScreenerTab } from '@/app/screener-tab';
import { StockAssistant } from '@/app/stock-assistant';
import { StrategyLab } from '@/app/strategy-lab';
import { marketSnapshot, snapshotAsOf, type MarketStock } from '@/lib/market-snapshot';
import { previousTradingDate } from '@/lib/market-session';
import { sectorFor } from '@/lib/sectors';


function tileColor(value: number) {
  const strength = Math.min(Math.abs(value) / 4, 1);
  if (value > 0) return `hsl(145 58% ${36 - strength * 17}%)`;
  if (value < 0) return `hsl(0 66% ${43 - strength * 19}%)`;
  return 'var(--market-flat)';
}

const intradayChartConfig = { close: { label: 'Price', color: '#4338ca' } } satisfies ChartConfig;

type IntradayPoint = { timestamp: number; sessionDate: string; time: string; open: number; high: number; low: number; close: number; volume: number };
type ChartRange = '1d' | '2d' | '1w' | '1m';
type OpenInterestPoint = { strike: number; callOi: number; putOi: number; callOiChange: number; putOiChange: number; callPreviousOi: number; putPreviousOi: number };
type OpenInterestPayload = { points: OpenInterestPoint[]; spot: number; atmStrike: number; expiry: string; totalCallOi: number; totalPutOi: number; source: string; asOf: string };

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

function formatOpenInterest(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000) return `${(value / 10_000_000).toFixed(2).replace(/\.00$/, '')}Cr`;
  if (absolute >= 100_000) return `${(value / 100_000).toFixed(1).replace(/\.0$/, '')}L`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return new Intl.NumberFormat('en-IN').format(value);
}

const openInterestChartConfig = {
  putOi: { label: 'Put OI', color: '#22c55e' },
  callOi: { label: 'Call OI', color: '#ef4444' },
} satisfies ChartConfig;

function OpenInterestTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: OpenInterestPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${formatOpenInterest(value)}`;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
      <div className="mb-2 font-semibold">Strike ₹{formatPrice(point.strike)}</div>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <span className="text-emerald-600">Put OI</span><strong className="tabular-nums">{formatOpenInterest(point.putOi)}</strong>
        <span className="text-muted-foreground">Put change</span><span className="tabular-nums">{signed(point.putOiChange)}</span>
        <span className="text-red-500">Call OI</span><strong className="tabular-nums">{formatOpenInterest(point.callOi)}</strong>
        <span className="text-muted-foreground">Call change</span><span className="tabular-nums">{signed(point.callOiChange)}</span>
      </div>
    </div>
  );
}

function OpenInterestChart({ stock, data, loading, error }: { stock: MarketStock; data: OpenInterestPayload | null; loading: boolean; error: string }) {
  const [showChange, setShowChange] = useState(true);
  if (loading) {
    return <div className="flex h-[360px] items-center justify-center rounded-xl border border-border bg-muted/20 text-xs text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />Loading option-chain OI…</div>;
  }
  if (!data?.points.length) {
    return <div className="flex h-[360px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 text-center text-xs text-muted-foreground">{error || 'No live option-chain OI is available for this stock.'}</div>;
  }

  const chartData = data.points.map((point) => ({
    ...point,
    putBase: Math.min(point.putOi, point.putPreviousOi),
    putIncrease: Math.max(point.putOi - point.putPreviousOi, 0),
    putDecrease: Math.max(point.putPreviousOi - point.putOi, 0),
    callBase: Math.min(point.callOi, point.callPreviousOi),
    callIncrease: Math.max(point.callOi - point.callPreviousOi, 0),
    callDecrease: Math.max(point.callPreviousOi - point.callOi, 0),
  }));
  const pcr = data.totalCallOi > 0 ? data.totalPutOi / data.totalCallOi : null;
  return (
    <figure className="rounded-xl border border-border bg-card p-3" aria-label={`${stock.ticker} open interest by strike`}>
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <div className="text-sm font-semibold">Open interest · {data.expiry}</div>
          <div className="text-[11px] text-muted-foreground">Nearest expiry · live FYERS option chain · updated {new Date(data.asOf).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</div>
        </div>
        <Button size="sm" variant={showChange ? 'secondary' : 'outline'} aria-pressed={showChange} onClick={() => setShowChange((current) => !current)}>OI change {showChange ? 'on' : 'off'}</Button>
      </figcaption>
      <div className="mb-2 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[11px]">
        <span><span className="block text-muted-foreground">Put OI</span><strong className="text-emerald-600">{formatOpenInterest(data.totalPutOi)}</strong></span>
        <span><span className="block text-muted-foreground">Call OI</span><strong className="text-red-500">{formatOpenInterest(data.totalCallOi)}</strong></span>
        <span><span className="block text-muted-foreground">PCR</span><strong>{pcr === null ? '—' : pcr.toFixed(2)}</strong></span>
      </div>
      <ChartContainer config={openInterestChartConfig} className="h-[300px] w-full aspect-auto" initialDimension={{ width: 480, height: 300 }}>
        <BarChart data={chartData} margin={{ top: 20, right: 8, bottom: 28, left: 0 }} barGap={1} barCategoryGap="24%">
          <defs>
            <pattern id="put-oi-increase" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="6" height="6" fill="#86efac" /><line x1="0" y1="0" x2="0" y2="6" stroke="#16a34a" strokeWidth="2" /></pattern>
            <pattern id="call-oi-increase" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="6" height="6" fill="#fca5a5" /><line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" strokeWidth="2" /></pattern>
          </defs>
          <CartesianGrid strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="strike" tickLine={false} axisLine={false} minTickGap={12} angle={-38} textAnchor="end" height={54} tick={{ fontSize: 9 }} tickFormatter={(value) => formatPrice(Number(value))} />
          <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 9 }} tickFormatter={(value) => formatOpenInterest(Number(value))} />
          <ReferenceLine x={data.atmStrike} stroke="#0f172a" strokeDasharray="4 3" label={{ value: `Spot ₹${formatPrice(data.spot)}`, position: 'insideTop', fill: '#0f172a', fontSize: 9 }} />
          <ChartTooltip cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} content={<OpenInterestTooltip />} />
          {showChange ? <>
            <Bar dataKey="putBase" stackId="put" fill="#22c55e" />
            <Bar dataKey="putIncrease" stackId="put" fill="url(#put-oi-increase)" />
            <Bar dataKey="putDecrease" stackId="put" fill="transparent" stroke="#22c55e" strokeWidth={1.5} />
            <Bar dataKey="callBase" stackId="call" fill="#ef4444" />
            <Bar dataKey="callIncrease" stackId="call" fill="url(#call-oi-increase)" />
            <Bar dataKey="callDecrease" stackId="call" fill="transparent" stroke="#ef4444" strokeWidth={1.5} />
          </> : <>
            <Bar dataKey="putOi" name="Put OI" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="callOi" name="Call OI" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </>}
        </BarChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-green-500" />Put OI</span>
        <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-red-500" />Call OI</span>
        {showChange && <><span>Striped = increase</span><span>Outline = decrease</span></>}
      </div>
    </figure>
  );
}

function IntradayPriceChart({ stock, points, loading, error }: { stock: MarketStock; points: IntradayPoint[]; loading: boolean; error: string }) {
  if (loading) {
    return <div className="flex h-[300px] items-center justify-center rounded-xl border border-border bg-muted/20 text-xs text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />Loading 5-minute chart…</div>;
  }
  if (!points.length) {
    return <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 text-center text-xs text-muted-foreground">{error || 'No intraday chart is available for this stock and date.'}</div>;
  }

  const sessions = [...new Set(points.map((point) => point.sessionDate))].sort();
  const sessionLabel = (sessionDate: string) => new Date(`${sessionDate}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const sessionSummary = sessions.length > 2
    ? `${sessionLabel(sessions[0])} → ${sessionLabel(sessions.at(-1)!)} · ${sessions.length} sessions`
    : sessions.map(sessionLabel).join(' → ');
  const chartData = sessions.flatMap((sessionDate, sessionIndex) => {
    const sessionPoints = points.filter((point) => point.sessionDate === sessionDate);
    const plotted = sessionPoints.map((point) => ({ ...point, chartKey: `${point.sessionDate}-${point.timestamp}`, close: point.close as number | null, gap: false }));
    if (sessionIndex === 0) return plotted;
    const first = sessionPoints[0];
    return first ? [{ ...first, chartKey: `session-break-${sessionDate}`, time: '', close: null, gap: true }, ...plotted] : plotted;
  });
  const closes = points.map((point) => point.close).filter(Number.isFinite);
  const firstClose = closes[0] ?? stock.previousClose;
  const latestClose = closes.at(-1) ?? stock.price;
  const rangeChangePct = firstClose ? ((latestClose / firstClose) - 1) * 100 : 0;
  const rawMin = Math.min(stock.previousClose, ...closes);
  const rawMax = Math.max(stock.previousClose, ...closes);
  const padding = Math.max((rawMax - rawMin) * 0.06, stock.previousClose * 0.001);
  const domainMin = rawMin - padding;
  const domainMax = rawMax + padding;
  const previousCloseOffset = Math.max(0, Math.min(100, ((domainMax - stock.previousClose) / (domainMax - domainMin)) * 100));
  const latestColor = latestClose >= stock.previousClose ? '#059669' : '#dc2626';
  const currentSession = sessions.at(-1);
  const breakKey = sessions.length > 1 && currentSession ? `session-break-${currentSession}` : null;
  return (
    <figure className="rounded-xl border border-border bg-card p-3" aria-label={`${stock.ticker} intraday price chart`}>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-3 px-1">
        <div><div className="text-sm font-semibold">Price chart</div><div className="text-[11px] text-muted-foreground">{sessionSummary} · 5-minute close · IST</div></div>
        <div className="flex items-center gap-3 text-right text-[11px]">
          <span className={`rounded-md px-2 py-1 text-left ${rangeChangePct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}><span className="block opacity-70">Range change</span><strong>{rangeChangePct >= 0 ? '+' : ''}{rangeChangePct.toFixed(2)}%</strong></span>
          <span><span className="block text-muted-foreground">Day low</span><strong>{stock.low !== undefined ? `₹${formatPrice(stock.low)}` : '—'}</strong></span>
          <span><span className="block text-muted-foreground">Day high</span><strong>{stock.high !== undefined ? `₹${formatPrice(stock.high)}` : '—'}</strong></span>
        </div>
      </figcaption>
      <ChartContainer config={intradayChartConfig} className="h-[280px] w-full aspect-auto" initialDimension={{ width: 480, height: 280 }}>
        <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="intraday-price-stroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" />
              <stop offset={`${previousCloseOffset}%`} stopColor="#059669" />
              <stop offset={`${previousCloseOffset}%`} stopColor="#dc2626" />
              <stop offset="100%" stopColor="#dc2626" />
            </linearGradient>
            <linearGradient id="intraday-price-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.36} />
              <stop offset={`${previousCloseOffset}%`} stopColor="#10b981" stopOpacity={0.1} />
              <stop offset={`${previousCloseOffset}%`} stopColor="#ef4444" stopOpacity={0.1} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.34} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" vertical />
          <XAxis dataKey="chartKey" tickLine={false} axisLine={false} minTickGap={38} tick={{ fontSize: 10 }} tickFormatter={(value) => {
            const point = chartData.find((item) => item.chartKey === value);
            return point?.gap ? sessionLabel(point.sessionDate) : point?.time ?? '';
          }} />
          <YAxis domain={[domainMin, domainMax]} tickLine={false} axisLine={false} width={62} tick={{ fontSize: 10 }} tickFormatter={(value) => `₹${formatPrice(Number(value))}`} />
          {breakKey && <ReferenceLine x={breakKey} stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: `${sessionLabel(currentSession!)} starts`, position: 'insideTopRight', fill: '#64748b', fontSize: 10 }} />}
          <ReferenceLine y={stock.previousClose} stroke="#64748b" strokeDasharray="4 4" strokeOpacity={0.8} label={{ value: 'Prev', position: 'insideTopRight', fill: '#64748b', fontSize: 10 }} />
          <ChartTooltip cursor={{ stroke: latestColor, strokeDasharray: '3 3' }} content={<ChartTooltipContent labelFormatter={(_value, payload) => {
            const point = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
            return point && !point.gap ? `${sessionLabel(point.sessionDate)} · ${point.time}` : '';
          }} formatter={(value) => <><span className="text-muted-foreground">Price</span><span className="ml-auto font-mono font-semibold">₹{formatPrice(Number(value))}</span></>} />} />
          <Area type="monotone" dataKey="close" baseValue={stock.previousClose} connectNulls={false} stroke="url(#intraday-price-stroke)" strokeWidth={2.25} fill="url(#intraday-price-fill)" dot={false} activeDot={{ r: 4, fill: latestColor, stroke: 'white', strokeWidth: 2 }} />
        </AreaChart>
      </ChartContainer>
    </figure>
  );
}

export default function Home() {
  const [activeSurface, setActiveSurface] = useState<'heatmap' | 'backtest' | 'strategy-lab' | 'markov-regime' | 'screener' | 'board' | 'vwap' | 'vwap-backtest'>('heatmap');
  const [stocks, setStocks] = useState<MarketStock[]>(marketSnapshot);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All sectors');
  const [sort, setSort] = useState('change-desc');
  const [mode, setMode] = useState<'live' | 'historical'>('live');
  const [date, setDate] = useState(() => previousTradingDate(new Date(snapshotAsOf)));
  const [selected, setSelected] = useState<MarketStock | null>(marketSnapshot[0] ?? null);
  const [chartOpen, setChartOpen] = useState(false);
  const [asOf, setAsOf] = useState(snapshotAsOf);
  const [source, setSource] = useState('FYERS embedded snapshot');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [universe, setUniverse] = useState<{ source: 'engine' | 'static'; date: string | null; count: number; note: string } | null>(null);
  const [chartPoints, setChartPoints] = useState<IntradayPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');
  const [chartView, setChartView] = useState<'price' | 'oi'>('price');
  const [chartRange, setChartRange] = useState<ChartRange>('2d');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [regimeTicker, setRegimeTicker] = useState<string | null>(null);
  const [marketAssistantOpen, setMarketAssistantOpen] = useState(false);
  const [openInterest, setOpenInterest] = useState<OpenInterestPayload | null>(null);
  const [openInterestLoading, setOpenInterestLoading] = useState(false);
  const [openInterestError, setOpenInterestError] = useState('');

  const loadMarket = useCallback(async (target: 'live' | 'historical') => {
    setLoading(true);
    setMessage('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/market?date=${target === 'live' ? 'live' : date}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json() as { stocks?: MarketStock[]; asOf?: string; source?: string; notice?: string; error?: string; universe?: { source: 'engine' | 'static'; date: string | null; count: number; note: string; hidden?: number } };
      if (!response.ok || !payload.stocks) throw new Error(payload.error ?? 'Unable to load market data.');
      setStocks(payload.stocks);
      setAsOf(payload.asOf ?? new Date().toISOString());
      setSource(payload.source ?? 'Market data');
      setUniverse(payload.universe ?? null);
      setMessage([payload.notice, payload.universe?.source === 'static' || payload.universe?.hidden ? payload.universe.note : ''].filter(Boolean).join(' '));
      setSelected((current) => payload.stocks?.find((stock) => stock.ticker === current?.ticker) ?? payload.stocks?.[0] ?? null);
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'Refresh timed out after 20 seconds. FYERS did not respond; the last snapshot is still displayed.'
        : error instanceof Error ? error.message : 'Unable to load market data.');
      if (target === 'live') setSource('FYERS live unavailable');
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (mode !== 'live') return;
    void loadMarket('live');
    const timer = window.setInterval(() => void loadMarket('live'), 180_000);
    return () => window.clearInterval(timer);
  }, [mode, loadMarket]);

  // The first render must match the server's, so the date starts from the snapshot and moves to today after mount.
  useEffect(() => { setDate(previousTradingDate(new Date())); }, []);

  const selectedSymbol = selected?.symbol;

  useEffect(() => {
    if (!selectedSymbol || !chartOpen) return;
    const controller = new AbortController();
    const requestDate = mode === 'live' ? 'live' : date;
    setChartLoading(true);
    setChartError('');
    setChartPoints([]);
    const requestTimer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/market/chart?symbol=${encodeURIComponent(selectedSymbol)}&date=${requestDate}&range=${chartRange}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json() as { points?: IntradayPoint[]; error?: string };
        if (!response.ok || !payload.points) throw new Error(payload.error ?? 'Unable to load the intraday chart.');
        setChartPoints(payload.points);
      } catch (error) {
        if (controller.signal.aborted) return;
        setChartError(error instanceof Error ? error.message : 'Unable to load the intraday chart.');
      } finally {
        if (!controller.signal.aborted) setChartLoading(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(requestTimer);
      controller.abort();
    };
  }, [selectedSymbol, chartOpen, chartRange, mode, date, asOf]);

  useEffect(() => {
    if (mode === 'historical') setChartView('price');
  }, [mode]);

  useEffect(() => {
    if (!selectedSymbol || !chartOpen || chartView !== 'oi' || mode !== 'live') return;
    const controller = new AbortController();
    setOpenInterestLoading(true);
    setOpenInterestError('');
    setOpenInterest(null);
    const requestTimer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/market/open-interest?symbol=${encodeURIComponent(selectedSymbol)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json() as OpenInterestPayload & { error?: string };
        if (!response.ok || !payload.points) throw new Error(payload.error ?? 'Unable to load open interest.');
        setOpenInterest(payload);
      } catch (error) {
        if (controller.signal.aborted) return;
        setOpenInterestError(error instanceof Error ? error.message : 'Unable to load open interest.');
      } finally {
        if (!controller.signal.aborted) setOpenInterestLoading(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(requestTimer);
      controller.abort();
    };
  }, [selectedSymbol, chartOpen, chartView, mode, asOf]);

  const enriched = useMemo(() => stocks.map((stock) => ({ ...stock, sector: sectorFor(stock.ticker) })), [stocks]);
  const sectorTiles = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const stock of enriched) groups.set(stock.sector, [...(groups.get(stock.sector) ?? []), stock.changePct]);
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const allValues = enriched.map((stock) => stock.changePct);
    return [
      { key: 'All sectors', label: 'All F&O', count: allValues.length, changePct: average(allValues) },
      ...[...groups.entries()]
        .map(([label, values]) => ({ key: label, label, count: values.length, changePct: average(values) }))
        .sort((a, b) => b.changePct - a.changePct),
    ];
  }, [enriched]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return enriched
      .filter((stock) => sector === 'All sectors' || stock.sector === sector)
      .filter((stock) => !normalized || stock.ticker.toLowerCase().includes(normalized) || stock.name.toLowerCase().includes(normalized))
      .sort((a, b) => sort === 'change-asc' ? a.changePct - b.changePct : sort === 'ticker' ? a.ticker.localeCompare(b.ticker) : b.changePct - a.changePct);
  }, [enriched, query, sector, sort]);

  const { advances, declines, median } = useMemo(() => {
    const moves = visible.map((stock) => stock.changePct).sort((a, b) => a - b);
    const middle = Math.floor(moves.length / 2);
    const medianMove = moves.length === 0 ? 0 : moves.length % 2 === 1 ? moves[middle] : (moves[middle - 1] + moves[middle]) / 2;
    return {
      advances: visible.filter((stock) => stock.changePct > 0).length,
      declines: visible.filter((stock) => stock.changePct < 0).length,
      median: medianMove,
    };
  }, [visible]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-7">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Activity className="size-5" /></div>
            <div><h1 className="text-lg font-semibold tracking-tight">NSE F&amp;O Heat Map</h1><p className="text-xs text-muted-foreground">{universe ? `${universe.count}-stock F&O universe · ${universe.source === 'engine' ? `engine, ${universe.date}` : 'static list'}` : '210-stock FYERS universe'}</p></div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              {source === 'FYERS live' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
              <span className={`relative inline-flex size-2 rounded-full ${source === 'FYERS live' ? 'bg-emerald-500' : source.includes('snapshot') || source.includes('unavailable') ? 'bg-amber-500' : 'bg-slate-400'}`} />
            </span>
            {source} · {new Date(asOf).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST{mode === 'live' ? ' · refreshes every 3 min' : ''}
          </div>
        </div>
      </header>

      <nav aria-label="App sections" className="overflow-x-auto overscroll-x-contain border-b border-border bg-background [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto flex w-full min-w-max max-w-[1800px] gap-1 px-4 py-2 lg:px-7">
          <Button size="sm" variant={activeSurface === 'heatmap' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('heatmap')}><LayoutGrid />Market heat map</Button>
          <Button size="sm" variant={activeSurface === 'strategy-lab' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('strategy-lab')}><TrendingUp />Options payoff test</Button>
          <Button size="sm" variant={activeSurface === 'backtest' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('backtest')}><FlaskConical />6-month strategy test</Button>
          <Button size="sm" variant={activeSurface === 'markov-regime' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('markov-regime')}><Activity />Markov regime</Button>
          <Button size="sm" variant={activeSurface === 'screener' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('screener')}><ScanSearch />Screener</Button>
          <Button size="sm" variant={activeSurface === 'board' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('board')}><Layers />OrderBlock Board</Button>
          <Button size="sm" variant={activeSurface === 'vwap' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('vwap')}><Waves />VWAP Scan</Button>
          <Button size="sm" variant={activeSurface === 'vwap-backtest' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('vwap-backtest')}><FlaskConical />VWAP Backtest</Button>
        </div>
      </nav>

      <section className="mx-auto max-w-[1800px] space-y-4 px-4 py-5 lg:px-7">
        {activeSurface === 'vwap-backtest' ? <VwapBacktestTab /> : activeSurface === 'vwap' ? <VwapTab /> : activeSurface === 'board' ? <BoardTab /> : activeSurface === 'screener' ? <ScreenerTab /> : activeSurface === 'markov-regime' ? <MarkovRegime key={regimeTicker ?? 'default'} initialTicker={regimeTicker ?? undefined} /> : activeSurface === 'backtest' ? <BacktestPanel /> : activeSurface === 'strategy-lab' ? <StrategyLab /> : <>
        <Card className="gap-3 py-3">
          <CardContent className="flex flex-wrap items-end gap-3 px-3">
            <div className="flex rounded-lg bg-muted p-1">
              <Button size="sm" variant={mode === 'live' ? 'default' : 'ghost'} onClick={() => setMode('live')}><Radio />Live today</Button>
              <Button size="sm" variant={mode === 'historical' ? 'default' : 'ghost'} onClick={() => setMode('historical')}><CalendarDays />Historical</Button>
            </div>
            <label className="grid gap-1 text-xs text-muted-foreground">Trading date<Input type="date" value={date} disabled={mode === 'live'} onChange={(event) => setDate(event.target.value)} className="w-[155px]" /></label>
            <label className="relative grid min-w-[220px] flex-1 gap-1 text-xs text-muted-foreground">Search stocks<Search className="absolute bottom-2 left-2.5 size-4" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker or company" className="pl-8" /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Sort<Select value={sort} onValueChange={(value) => setSort(value ?? 'change-desc')}><SelectTrigger className="w-[160px]"><SlidersHorizontal /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="change-desc">Gainers first</SelectItem><SelectItem value="change-asc">Losers first</SelectItem><SelectItem value="ticker">Ticker A–Z</SelectItem></SelectContent></Select></label>
            <Button variant="outline" onClick={() => window.location.assign('/api/fyers/login')}><Link2 />Connect FYERS</Button>
            <Button variant="outline" disabled={loading} onClick={() => void loadMarket(mode)}><RefreshCw className={loading ? 'animate-spin' : ''} />{mode === 'live' ? 'Refresh' : 'Load date'}</Button>
            <Button onClick={() => setMarketAssistantOpen(true)}><Sparkles />AI market analyst</Button>
          </CardContent>
        </Card>

        <section aria-label="Sector performance filters">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold">Sector performance</h2><p className="text-[11px] text-muted-foreground">Average move across F&O stocks · select a tile to filter</p></div>
            {sector !== 'All sectors' && <Button size="sm" variant="ghost" onClick={() => setSector('All sectors')}>Show all F&O</Button>}
          </div>
          <div className="sector-tile-strip">
            {sectorTiles.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sector-performance-tile ${sector === item.key ? 'is-selected' : ''}`}
                style={{ background: tileColor(item.changePct) }}
                onClick={() => setSector(item.key)}
                aria-pressed={sector === item.key}
                aria-label={`${item.label}, ${item.changePct >= 0 ? 'up' : 'down'} ${Math.abs(item.changePct).toFixed(2)} percent, ${item.count} stocks`}
              >
                <span className="truncate text-xs font-semibold">{item.label}</span>
                <strong className="text-base tabular-nums">{item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%</strong>
                <span className="text-[10px] text-white/75">{item.count} stocks</span>
              </button>
            ))}
          </div>
        </section>

        {message && <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><AlertCircle className="size-4 shrink-0" />{message}</div>}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="market-stat"><span>Advancers</span><strong className="text-emerald-500">{advances}</strong></div>
          <div className="market-stat"><span>Decliners</span><strong className="text-red-500">{declines}</strong></div>
          <div className="market-stat"><span>Median move</span><strong>{median.toFixed(2)}%</strong></div>
        </div>

        <div>
          <section aria-label="F&O stock heat map">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{visible.length} stocks shown</span><span className="flex flex-wrap items-center gap-2"><i className="size-2 rounded-sm bg-red-800" />strong negative <i className="size-2 rounded-sm bg-red-500" />negative <i className="size-2 rounded-sm bg-neutral-500" />flat <i className="size-2 rounded-sm bg-green-600" />positive <i className="size-2 rounded-sm bg-green-900" />strong positive</span></div>
            <div className="heat-grid">
              {visible.map((stock) => (
                <button
                  key={stock.symbol}
                  type="button"
                  className="heat-tile"
                  style={{ background: tileColor(stock.changePct) }}
                  onClick={() => {
                    setSelected(stock);
                    setChartOpen(true);
                  }}
                  aria-label={`${stock.ticker}, current price ${formatPrice(stock.price)}, day high ${stock.high ? formatPrice(stock.high) : 'unavailable'}, day low ${stock.low ? formatPrice(stock.low) : 'unavailable'}, ${stock.changePct.toFixed(2)} percent, ${stock.sector}`}
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-semibold">{stock.ticker}</span>
                    <strong className="shrink-0 text-xs tabular-nums">{stock.changePct > 0 ? '+' : ''}{stock.changePct.toFixed(2)}%</strong>
                  </span>
                  <strong className="text-base tabular-nums">₹{formatPrice(stock.price)}</strong>
                  <span className="grid w-full grid-cols-2 gap-2 text-[10px] tabular-nums text-white/85">
                    <span><span className="opacity-70">Day H </span>{stock.high ? formatPrice(stock.high) : '—'}</span>
                    <span><span className="opacity-70">Day L </span>{stock.low ? formatPrice(stock.low) : '—'}</span>
                  </span>
                  <span className="w-full truncate text-[10px] opacity-75">{stock.sector}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <Dialog open={chartOpen} onOpenChange={setChartOpen}>
          <DialogContent className="top-0 left-0 h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100dvw-2rem)] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
            {selected && <>
              <DialogHeader className="min-w-0 shrink-0 border-b border-border px-4 py-4 pr-14 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <DialogTitle className="truncate text-lg">{selected.ticker}</DialogTitle>
                    <DialogDescription className="truncate text-xs">{sectorFor(selected.ticker)} · NSE</DialogDescription>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-2xl font-semibold leading-none tabular-nums">₹{formatPrice(selected.price)}</div>
                    <div className={`mt-1 text-xs ${selected.changePct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{selected.change >= 0 ? '+' : ''}{formatPrice(selected.change)} · {selected.changePct >= 0 ? '+' : ''}{selected.changePct.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="mt-2 flex max-w-full flex-wrap items-center gap-2">
                  <div className="flex rounded-lg bg-muted p-1" aria-label="Chart view">
                    <Button size="sm" variant={chartView === 'price' ? 'secondary' : 'ghost'} onClick={() => setChartView('price')} title="Price chart"><LineChart />Price</Button>
                    <Button size="sm" variant={chartView === 'oi' ? 'secondary' : 'ghost'} onClick={() => setChartView('oi')} disabled={mode !== 'live'} title={mode === 'live' ? 'Open interest chart' : 'Open interest is available in Live today mode'}><BarChart3 />Open interest</Button>
                  </div>
                  {chartView === 'price' && <div className="flex rounded-lg bg-muted p-1" aria-label="Price chart range">
                    {([['1d', '1D'], ['2d', '2D'], ['1w', '1W'], ['1m', '1M']] as const).map(([value, label]) => (
                      <Button key={value} size="sm" variant={chartRange === value ? 'secondary' : 'ghost'} aria-pressed={chartRange === value} onClick={() => setChartRange(value)}>{label}</Button>
                    ))}
                  </div>}
                  <Button size="sm" variant={assistantOpen ? 'default' : 'outline'} aria-pressed={assistantOpen} onClick={() => setAssistantOpen((current) => !current)} title="Ask AI about this stock"><Sparkles />AI analyst</Button>
                  <Button size="sm" variant="outline" onClick={() => { setRegimeTicker(selected.ticker); setChartOpen(false); setActiveSurface('markov-regime'); }} title={`Open the Markov regime tab for ${selected.ticker}`}><Activity />Markov regime</Button>
                  <Button size="sm" variant={teamOpen ? 'default' : 'outline'} aria-pressed={teamOpen} onClick={() => setTeamOpen((current) => !current)} title="Run the AI research team on this stock"><Users />Run research team</Button>
                </div>
              </DialogHeader>
              <div className="min-h-0 min-w-0 space-y-4 overflow-x-hidden overflow-y-auto px-3 pb-6 sm:px-6">
                {chartView === 'price'
                  ? <IntradayPriceChart stock={selected} points={chartPoints} loading={chartLoading} error={chartError} />
                  : <OpenInterestChart stock={selected} data={openInterest} loading={openInterestLoading} error={openInterestError} />}
                {teamOpen && <AgentRunPanel key={selected.ticker} symbol={selected.symbol} />}
                {assistantOpen && <StockAssistant key={selected.ticker} stock={selected} sector={sectorFor(selected.ticker)} points={chartPoints} range={chartRange.toUpperCase()} />}
                <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Previous close</dt><dd className="tabular-nums">₹{formatPrice(selected.previousClose)}</dd></div>
                  <div><dt className="text-muted-foreground">Exchange</dt><dd>NSE</dd></div>
                  {selected.open !== undefined && <div><dt className="text-muted-foreground">Open</dt><dd className="tabular-nums">₹{formatPrice(selected.open)}</dd></div>}
                  {selected.high !== undefined && <div><dt className="text-muted-foreground">High</dt><dd className="tabular-nums">₹{formatPrice(selected.high)}</dd></div>}
                  {selected.low !== undefined && <div><dt className="text-muted-foreground">Low</dt><dd className="tabular-nums">₹{formatPrice(selected.low)}</dd></div>}
                  {selected.volume !== undefined && <div><dt className="text-muted-foreground">Volume</dt><dd className="tabular-nums">{new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(selected.volume)}</dd></div>}
                </dl>
              </div>
            </>}
          </DialogContent>
        </Dialog>

        <HeatmapAssistant
          open={marketAssistantOpen}
          onOpenChange={setMarketAssistantOpen}
          stocks={enriched}
          asOf={asOf}
          source={source}
          onOpenStock={(stock) => {
            setSelected(stock);
            setMarketAssistantOpen(false);
            setChartOpen(true);
          }}
        />

        </>}
      </section>
    </main>
  );
}
