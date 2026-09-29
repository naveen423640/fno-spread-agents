'use client';

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CalendarDays, CircleDollarSign, Gauge, Search, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Metrics = {
  trades: number;
  targetHits: number;
  targetHitRate: number;
  profitableTradeRate: number;
  averageWinner: number;
  averageLoser: number;
  expectancy: number;
  profitFactor: number | null;
  netPnl: number;
  averageR: number;
  totalR: number;
  medianR: number;
  maximumDrawdown: number;
  maximumDrawdownR: number;
  averageHoldingDays: number;
};

type DirectionRow = Metrics & { group: 'BULL_CALL' | 'BEAR_PUT' | 'COMBINED' };
type MonthlyRow = Metrics & { month: string; direction: 'BULL_CALL' | 'BEAR_PUT' | 'COMBINED' };
type RewardRiskRow = Metrics & { band: string };
type TargetRow = Metrics & { targetPercent: number };
type StopRow = Metrics & { stopPercent: number | null; label: string };
type MaeRow = { bucket: string; trades: number; percentage: number; laterReached80: number; recoveryRate: number; averageFinalPnl: number; medianFinalPnl: number };
type RecoveryRow = { direction: string; trades: number; reachedApproximately100: number; percentageOfTrades: number; recoveredAboveZero: number; reached50Target: number; reached80Target: number; recoveryPercent: number; target80RecoveryPercent: number; remainingLosers: number; averageFinalPnl: number; medianFinalPnl: number; averageDaysRemaining: number; medianDaysRemaining: number };
type StockRow = { stock: string; appearances: number; combined: Metrics; bullCall: Metrics; bearPut: Metrics };

export type BacktestReport = {
  methodology: Record<string, string | boolean>;
  table1Overall: Metrics;
  table2Direction: DirectionRow[];
  table3RewardRisk: RewardRiskRow[];
  table4TargetSensitivity: TargetRow[];
  table5StopControls: StopRow[];
  table6MaeRecovery: MaeRow[];
  table7WorthlessRecovery: RecoveryRow[];
  table8Monthly: MonthlyRow[];
  table9Stocks: StockRow[];
  table10Portfolio: {
    trades: number;
    entryCohorts: number;
    maximumSimultaneousPositions: number;
    maximumSimultaneousTheoreticalRisk: number;
    oneSpreadPerStockMonth: Metrics;
    equalRisk: { averageR: number; totalR: number; medianR: number; maximumDrawdownR: number };
    dailyPortfolioMtm: number | null;
    dailyPortfolioMtmReason: string;
  };
};

type View = 'overview' | 'monthly' | 'sensitivity' | 'recovery' | 'stocks';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const shortMoney = (value: number) => {
  const sign = value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000) return `${sign}₹${(absolute / 10_000_000).toFixed(2)}Cr`;
  if (absolute >= 100_000) return `${sign}₹${(absolute / 100_000).toFixed(2)}L`;
  if (absolute >= 1_000) return `${sign}₹${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}₹${Math.round(absolute)}`;
};
const signedClass = (value: number) => value >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400';
const directionLabel = (value: string) => value === 'BULL_CALL' ? 'Bull Call' : value === 'BEAR_PUT' ? 'Bear Put' : 'Combined';
const monthLabel = (value: string) => new Date(`${value}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

const pnlConfig = {
  bull: { label: 'Bull Call', color: '#16a34a' },
  bear: { label: 'Bear Put', color: '#dc2626' },
  combined: { label: 'Combined', color: '#2563eb' },
} satisfies ChartConfig;

function MetricCard({ label, value, detail, tone = 'neutral', icon: Icon }: { label: string; value: string; detail: string; tone?: 'positive' | 'negative' | 'neutral'; icon: typeof Activity }) {
  return <Card className="overflow-hidden">
    <CardContent className="p-4">
      <div className="flex items-start justify-between gap-3"><span className="text-xs font-medium text-muted-foreground">{label}</span><Icon className={`size-4 ${tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : 'text-primary'}`} /></div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tone === 'positive' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'negative' ? 'text-red-700 dark:text-red-400' : ''}`}>{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </CardContent>
  </Card>;
}

function MetricsTable({ rows, labelKey = 'group' }: { rows: Array<Metrics & Record<string, unknown>>; labelKey?: string }) {
  return <div className="overflow-x-auto rounded-lg border"><Table>
    <TableHeader><TableRow><TableHead>Group</TableHead><TableHead className="text-right">Trades</TableHead><TableHead className="text-right">Hit rate</TableHead><TableHead className="text-right">Win rate</TableHead><TableHead className="text-right">Expectancy</TableHead><TableHead className="text-right">Profit factor</TableHead><TableHead className="text-right">Net P&amp;L</TableHead><TableHead className="text-right">Max DD</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((row) => {
      const rawValue = row[labelKey];
      const rawLabel = typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : '';
      const label = labelKey === 'group' || labelKey === 'direction' ? directionLabel(rawLabel) : rawLabel;
      return <TableRow key={rawLabel}><TableCell className="font-medium">{label}</TableCell><TableCell className="text-right tabular-nums">{row.trades}</TableCell><TableCell className="text-right tabular-nums">{row.targetHitRate.toFixed(2)}%</TableCell><TableCell className="text-right tabular-nums">{row.profitableTradeRate.toFixed(2)}%</TableCell><TableCell className={`text-right tabular-nums ${signedClass(row.expectancy)}`}>{money.format(row.expectancy)}</TableCell><TableCell className="text-right tabular-nums">{row.profitFactor === null ? '—' : row.profitFactor.toFixed(2)}</TableCell><TableCell className={`text-right font-medium tabular-nums ${signedClass(row.netPnl)}`}>{money.format(row.netPnl)}</TableCell><TableCell className="text-right tabular-nums text-red-700 dark:text-red-400">{money.format(row.maximumDrawdown)}</TableCell></TableRow>;
    })}</TableBody>
  </Table></div>;
}

function Overview({ report }: { report: BacktestReport }) {
  const overall = report.table1Overall;
  const bull = report.table2Direction.find((row) => row.group === 'BULL_CALL');
  const bear = report.table2Direction.find((row) => row.group === 'BEAR_PUT');
  const bestMonth = report.table8Monthly.filter((row) => row.direction === 'COMBINED').sort((a, b) => b.netPnl - a.netPnl)[0];
  const worstMonth = report.table8Monthly.filter((row) => row.direction === 'COMBINED').sort((a, b) => a.netPnl - b.netPnl)[0];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <MetricCard label="Net P&L" value={money.format(overall.netPnl)} detail="Across all executable spreads" tone={overall.netPnl >= 0 ? 'positive' : 'negative'} icon={CircleDollarSign} />
      <MetricCard label="Profit factor" value={overall.profitFactor?.toFixed(2) ?? '—'} detail="Gross profit ÷ gross loss" tone={(overall.profitFactor ?? 0) > 1 ? 'positive' : 'negative'} icon={Gauge} />
      <MetricCard label="Expectancy" value={money.format(overall.expectancy)} detail="Average net P&L per trade" tone={overall.expectancy >= 0 ? 'positive' : 'negative'} icon={Activity} />
      <MetricCard label="80% target hit" value={`${overall.targetHitRate.toFixed(2)}%`} detail={`${overall.targetHits} of ${overall.trades} trades`} icon={Target} />
      <MetricCard label="Maximum drawdown" value={shortMoney(overall.maximumDrawdown)} detail="Sequential one-spread P&L curve" tone="negative" icon={TrendingDown} />
      <MetricCard label="Holding period" value={`${overall.averageHoldingDays.toFixed(1)} days`} detail={`${overall.trades} executable trades`} icon={CalendarDays} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <Card><CardHeader><CardTitle>Direction comparison</CardTitle><p className="text-xs text-muted-foreground">Same universe and rules, tested independently in both directions.</p></CardHeader><CardContent><MetricsTable rows={report.table2Direction as Array<Metrics & Record<string, unknown>>} /></CardContent></Card>
      <Card><CardHeader><CardTitle>What drove the result</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30"><div className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300"><TrendingUp className="size-4" />Bear Put carried the portfolio</div><p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-300/80">{money.format(bear?.netPnl ?? 0)} net, versus {money.format(bull?.netPnl ?? 0)} from Bull Call.</p></div>
        <div className="rounded-lg border p-3"><span className="text-xs text-muted-foreground">Best month</span><div className="mt-1 flex items-center justify-between"><strong>{bestMonth ? monthLabel(bestMonth.month) : '—'}</strong><span className="font-semibold text-emerald-700 dark:text-emerald-400">{bestMonth ? money.format(bestMonth.netPnl) : '—'}</span></div></div>
        <div className="rounded-lg border p-3"><span className="text-xs text-muted-foreground">Worst month</span><div className="mt-1 flex items-center justify-between"><strong>{worstMonth ? monthLabel(worstMonth.month) : '—'}</strong><span className="font-semibold text-red-700 dark:text-red-400">{worstMonth ? money.format(worstMonth.netPnl) : '—'}</span></div></div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mr-1 inline size-3" />R-normalized metrics include very small-debit outliers. Use rupee P&amp;L and drawdown as the primary reading.</div>
      </CardContent></Card>
    </div>

    <Card><CardHeader><CardTitle>Portfolio risk</CardTitle><p className="text-xs text-muted-foreground">Exposure if all eligible spreads in an entry cohort were taken.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[['Entry cohorts', report.table10Portfolio.entryCohorts.toString()], ['Maximum open positions', report.table10Portfolio.maximumSimultaneousPositions.toString()], ['Maximum theoretical risk', money.format(report.table10Portfolio.maximumSimultaneousTheoreticalRisk)], ['Median outcome', `${report.table10Portfolio.equalRisk.medianR.toFixed(2)}R`]].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div></div>)}
    </CardContent></Card>
  </div>;
}

function Monthly({ report }: { report: BacktestReport }) {
  const data = useMemo(() => {
    const months = [...new Set(report.table8Monthly.map((row) => row.month))];
    return months.map((month) => ({
      month: monthLabel(month),
      bull: report.table8Monthly.find((row) => row.month === month && row.direction === 'BULL_CALL')?.netPnl ?? 0,
      bear: report.table8Monthly.find((row) => row.month === month && row.direction === 'BEAR_PUT')?.netPnl ?? 0,
      combined: report.table8Monthly.find((row) => row.month === month && row.direction === 'COMBINED')?.netPnl ?? 0,
    }));
  }, [report]);
  const combined = report.table8Monthly.filter((row) => row.direction === 'COMBINED');
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Monthly P&amp;L by direction</CardTitle><p className="text-xs text-muted-foreground">Green is Bull Call; red is Bear Put. Their sum is the combined monthly result.</p></CardHeader><CardContent>
      <ChartContainer config={pnlConfig} className="h-[360px] w-full aspect-auto"><BarChart data={data} margin={{ left: 8, right: 8 }}><CartesianGrid vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis tickFormatter={shortMoney} width={72} tickLine={false} axisLine={false} /><ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.35} /><ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <><span className="text-muted-foreground">{pnlConfig[String(name) as keyof typeof pnlConfig]?.label ?? name}</span><span className="ml-auto font-mono font-medium">{money.format(Number(value))}</span></>} />} /><Bar dataKey="bull" fill="var(--color-bull)" radius={[4, 4, 0, 0]} /><Bar dataKey="bear" fill="var(--color-bear)" radius={[4, 4, 0, 0]} /></BarChart></ChartContainer>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Monthly combined scorecard</CardTitle></CardHeader><CardContent><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Trades</TableHead><TableHead className="text-right">80% hits</TableHead><TableHead className="text-right">Win rate</TableHead><TableHead className="text-right">Expectancy</TableHead><TableHead className="text-right">Profit factor</TableHead><TableHead className="text-right">Net P&amp;L</TableHead><TableHead className="text-right">Max DD</TableHead></TableRow></TableHeader><TableBody>{combined.map((row) => <TableRow key={row.month}><TableCell className="font-medium">{monthLabel(row.month)}</TableCell><TableCell className="text-right">{row.trades}</TableCell><TableCell className="text-right">{row.targetHitRate.toFixed(2)}%</TableCell><TableCell className="text-right">{row.profitableTradeRate.toFixed(2)}%</TableCell><TableCell className={`text-right ${signedClass(row.expectancy)}`}>{money.format(row.expectancy)}</TableCell><TableCell className="text-right">{row.profitFactor?.toFixed(2) ?? '—'}</TableCell><TableCell className={`text-right font-medium ${signedClass(row.netPnl)}`}>{money.format(row.netPnl)}</TableCell><TableCell className="text-right text-red-700 dark:text-red-400">{money.format(row.maximumDrawdown)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
  </div>;
}

function Sensitivity({ report }: { report: BacktestReport }) {
  const targetData = report.table4TargetSensitivity.map((row) => ({ target: `${row.targetPercent}%`, netPnl: row.netPnl, hitRate: row.targetHitRate }));
  const controlConfig = { netPnl: { label: 'Net P&L', color: '#2563eb' }, hitRate: { label: 'Hit rate', color: '#9333ea' } } satisfies ChartConfig;
  return <div className="space-y-4">
    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Profit-target sensitivity</CardTitle><p className="text-xs text-muted-foreground">All entries are identical; only the target changes.</p></CardHeader><CardContent><ChartContainer config={controlConfig} className="h-[300px] w-full aspect-auto"><LineChart data={targetData} margin={{ left: 10, right: 16 }}><CartesianGrid vertical={false} /><XAxis dataKey="target" tickLine={false} axisLine={false} /><YAxis yAxisId="pnl" tickFormatter={shortMoney} width={68} tickLine={false} axisLine={false} /><YAxis yAxisId="rate" orientation="right" tickFormatter={(value) => `${value}%`} width={42} tickLine={false} axisLine={false} /><ReferenceLine yAxisId="pnl" y={0} stroke="currentColor" strokeOpacity={0.3} /><ChartTooltip content={<ChartTooltipContent />} /><Line yAxisId="pnl" dataKey="netPnl" stroke="var(--color-netPnl)" strokeWidth={2.5} dot={{ r: 4 }} /><Line yAxisId="rate" dataKey="hitRate" stroke="var(--color-hitRate)" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ChartContainer></CardContent></Card>
      <Card><CardHeader><CardTitle>Stop-loss comparison</CardTitle><p className="text-xs text-muted-foreground">Stops are evaluated on daily closes, not intraday touches.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{report.table5StopControls.map((row) => <div key={row.label} className={`rounded-lg border p-4 ${row.label === '-50%' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : ''}`}><div className="flex items-center justify-between"><strong>{row.label.replace('NO_SL', 'No stop')}</strong>{row.label === '-50%' && <Badge className="bg-emerald-700">Best net P&amp;L</Badge>}</div><div className={`mt-3 text-xl font-semibold ${signedClass(row.netPnl)}`}>{money.format(row.netPnl)}</div><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><span className="text-muted-foreground">Expectancy</span><span className="text-right">{money.format(row.expectancy)}</span><span className="text-muted-foreground">Profit factor</span><span className="text-right">{row.profitFactor?.toFixed(2) ?? '—'}</span><span className="text-muted-foreground">Max DD</span><span className="text-right text-red-700 dark:text-red-400">{shortMoney(row.maximumDrawdown)}</span></div></div>)}</CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Actual reward:risk bands</CardTitle><p className="text-xs text-muted-foreground">The primary selection requires at least 2.0 actual reward:risk, so lower bands contain no trades.</p></CardHeader><CardContent><MetricsTable rows={report.table3RewardRisk as Array<Metrics & Record<string, unknown>>} labelKey="band" /></CardContent></Card>
    <Card><CardHeader><CardTitle>Target sensitivity details</CardTitle></CardHeader><CardContent><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Target</TableHead><TableHead className="text-right">Hits</TableHead><TableHead className="text-right">Hit rate</TableHead><TableHead className="text-right">Expectancy</TableHead><TableHead className="text-right">Profit factor</TableHead><TableHead className="text-right">Net P&amp;L</TableHead><TableHead className="text-right">Avg hold</TableHead></TableRow></TableHeader><TableBody>{report.table4TargetSensitivity.map((row) => <TableRow key={row.targetPercent}><TableCell className="font-medium">{row.targetPercent}%</TableCell><TableCell className="text-right">{row.targetHits}</TableCell><TableCell className="text-right">{row.targetHitRate.toFixed(2)}%</TableCell><TableCell className={`text-right ${signedClass(row.expectancy)}`}>{money.format(row.expectancy)}</TableCell><TableCell className="text-right">{row.profitFactor?.toFixed(2) ?? '—'}</TableCell><TableCell className={`text-right font-medium ${signedClass(row.netPnl)}`}>{money.format(row.netPnl)}</TableCell><TableCell className="text-right">{row.averageHoldingDays.toFixed(1)}d</TableCell></TableRow>)}</TableBody></Table></div><p className="mt-2 text-[11px] text-muted-foreground">At 100%, exit slippage makes an exact maximum-profit target unreachable; that row effectively reflects T−1 exits.</p></CardContent></Card>
  </div>;
}

function Recovery({ report }: { report: BacktestReport }) {
  const config = { share: { label: 'Share of trades', color: '#64748b' }, recovered: { label: 'Later reached 80%', color: '#16a34a' } } satisfies ChartConfig;
  const data = report.table6MaeRecovery.map((row) => ({ bucket: row.bucket.replace('Reached approximately ', '≈').replace('Never reached ', 'Never '), share: row.percentage, recovered: row.recoveryRate }));
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Recovery by maximum adverse excursion</CardTitle><p className="text-xs text-muted-foreground">How often a trade later reached the 80% target after entering each loss bucket.</p></CardHeader><CardContent><ChartContainer config={config} className="h-[340px] w-full aspect-auto"><BarChart data={data} margin={{ left: 4, right: 4 }}><CartesianGrid vertical={false} /><XAxis dataKey="bucket" tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={65} /><YAxis tickFormatter={(value) => `${value}%`} width={42} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="share" fill="var(--color-share)" radius={[4, 4, 0, 0]} /><Bar dataKey="recovered" fill="var(--color-recovered)" radius={[4, 4, 0, 0]} /></BarChart></ChartContainer></CardContent></Card>
    <Card><CardHeader><CardTitle>MAE recovery table</CardTitle></CardHeader><CardContent><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Deepest daily-close loss</TableHead><TableHead className="text-right">Trades</TableHead><TableHead className="text-right">Share</TableHead><TableHead className="text-right">Later hit 80%</TableHead><TableHead className="text-right">Recovery rate</TableHead><TableHead className="text-right">Average final P&amp;L</TableHead></TableRow></TableHeader><TableBody>{report.table6MaeRecovery.map((row) => <TableRow key={row.bucket}><TableCell className="font-medium">{row.bucket}</TableCell><TableCell className="text-right">{row.trades}</TableCell><TableCell className="text-right">{row.percentage.toFixed(2)}%</TableCell><TableCell className="text-right">{row.laterReached80}</TableCell><TableCell className="text-right">{row.recoveryRate.toFixed(2)}%</TableCell><TableCell className={`text-right ${signedClass(row.averageFinalPnl)}`}>{money.format(row.averageFinalPnl)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Approximately −100% MTM recovery</CardTitle><p className="text-xs text-muted-foreground">Recovery measured after a spread reached approximately its maximum loss on a daily close.</p></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-3">{report.table7WorthlessRecovery.map((row) => <div key={row.direction} className="rounded-lg border p-4"><div className="flex items-center justify-between"><strong>{directionLabel(row.direction)}</strong><Badge variant="outline">{row.reachedApproximately100} trades</Badge></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><span className="text-muted-foreground">Affected</span><span className="text-right">{row.percentageOfTrades.toFixed(2)}%</span><span className="text-muted-foreground">Recovered above ₹0</span><span className="text-right">{row.recoveredAboveZero}</span><span className="text-muted-foreground">Reached 50% target</span><span className="text-right">{row.reached50Target}</span><span className="text-muted-foreground">Reached 80% target</span><span className="text-right">{row.reached80Target}</span><span className="text-muted-foreground">Avg final P&amp;L</span><span className="text-right text-red-700 dark:text-red-400">{money.format(row.averageFinalPnl)}</span><span className="text-muted-foreground">Days remaining</span><span className="text-right">{row.averageDaysRemaining.toFixed(1)}</span></div></div>)}</div></CardContent></Card>
  </div>;
}

function Stocks({ report }: { report: BacktestReport }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'netPnl' | 'expectancy' | 'targetHitRate' | 'appearances'>('netPnl');
  const rows = useMemo(() => report.table9Stocks
    .filter((row) => row.stock.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === 'appearances' ? b.appearances - a.appearances : b.combined[sort] - a.combined[sort]), [report, query, sort]);
  return <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Stock-level research</CardTitle><p className="mt-1 text-xs text-muted-foreground">Historical contribution and expectancy only—not a current trade ranking.</p></div><div className="flex w-full gap-2 sm:w-auto"><div className="relative min-w-0 flex-1 sm:w-56"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol" aria-label="Search stock symbol" /></div><NativeSelect value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort stock table"><NativeSelectOption value="netPnl">Net P&amp;L</NativeSelectOption><NativeSelectOption value="expectancy">Expectancy</NativeSelectOption><NativeSelectOption value="targetHitRate">Hit rate</NativeSelectOption><NativeSelectOption value="appearances">Appearances</NativeSelectOption></NativeSelect></div></div></CardHeader><CardContent>
    <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Stock</TableHead><TableHead className="text-right">Months</TableHead><TableHead className="text-right">Trades</TableHead><TableHead className="text-right">80% hit rate</TableHead><TableHead className="text-right">Win rate</TableHead><TableHead className="text-right">Expectancy</TableHead><TableHead className="text-right">Combined P&amp;L</TableHead><TableHead className="text-right">Bull P&amp;L</TableHead><TableHead className="text-right">Bear P&amp;L</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.stock}><TableCell className="font-semibold">{row.stock}</TableCell><TableCell className="text-right">{row.appearances}</TableCell><TableCell className="text-right">{row.combined.trades}</TableCell><TableCell className="text-right">{row.combined.targetHitRate.toFixed(2)}%</TableCell><TableCell className="text-right">{row.combined.profitableTradeRate.toFixed(2)}%</TableCell><TableCell className={`text-right ${signedClass(row.combined.expectancy)}`}>{money.format(row.combined.expectancy)}</TableCell><TableCell className={`text-right font-medium ${signedClass(row.combined.netPnl)}`}>{money.format(row.combined.netPnl)}</TableCell><TableCell className={`text-right ${signedClass(row.bullCall.netPnl)}`}>{money.format(row.bullCall.netPnl)}</TableCell><TableCell className={`text-right ${signedClass(row.bearPut.netPnl)}`}>{money.format(row.bearPut.netPnl)}</TableCell></TableRow>)}</TableBody></Table></div>
    <p className="mt-2 text-xs text-muted-foreground">Showing {rows.length} stocks. Sorting changes presentation only; it does not alter the backtest.</p>
  </CardContent></Card>;
}

export function BacktestResultsDashboard({ report, view }: { report: BacktestReport; view: View }) {
  if (view === 'overview') return <Overview report={report} />;
  if (view === 'monthly') return <Monthly report={report} />;
  if (view === 'sensitivity') return <Sensitivity report={report} />;
  if (view === 'recovery') return <Recovery report={report} />;
  return <Stocks report={report} />;
}
