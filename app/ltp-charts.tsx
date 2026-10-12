'use client';

import { Component, useEffect, useRef, type ReactNode } from 'react';
import { createChart, LineSeries, LineStyle, type UTCTimestamp } from 'lightweight-charts';

import type { UsableAnalysis } from '@/lib/ltp/analyze';
import type { Lines0920 } from '@/lib/ltp/lines0920';
import { LTP_CONFIG } from '@/lib/ltp/config';

const IST_OFFSET = 19_800; // lightweight-charts draws UTC, so shifting by +5:30 makes the time axis read in IST
// Plain hex colours: the chart library cannot parse the app's oklch() theme colours.
const GREEN = '#22c55e';
const RED = '#ef4444';
const BLUE = '#3b82f6';
const AMBER = '#f59e0b';

type Point = { time: UTCTimestamp; value: number };
type Series = { color: string; title: string; points: Point[] };
type Guide = { price: number; color: string; title: string; style?: LineStyle };

const toPoints = <T extends { ts: number }>(rows: T[], pick: (r: T) => number | null): Point[] =>
  rows.flatMap((r) => { const v = pick(r); return v === null ? [] : [{ time: (r.ts + IST_OFFSET) as UTCTimestamp, value: v }]; });

function LineCanvas({ series, guides, height }: { series: Series[]; guides: Guide[]; height: number }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const dark = document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#d1d5db' : '#374151', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(128,128,128,0.12)' }, horzLines: { color: 'rgba(128,128,128,0.12)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    series.forEach((s, i) => {
      const line = chart.addSeries(LineSeries, { color: s.color, lineWidth: 2, title: s.title, priceLineVisible: false });
      line.setData(s.points);
      // Keep every guide inside the visible price range, even when it is far from the price.
      if (i === 0 && guides.length) {
        const prices = guides.map((g) => g.price);
        line.applyOptions({ autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
          const r = original();
          if (!r?.priceRange) return r;
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...prices), maxValue: Math.max(r.priceRange.maxValue, ...prices) } };
        } });
      }
      if (i === 0) for (const g of guides) line.createPriceLine({ price: g.price, color: g.color, lineWidth: 1, lineStyle: g.style ?? LineStyle.Dashed, axisLabelVisible: true, title: g.title });
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series, guides]);
  return <div ref={container} style={{ height }} className="w-full text-foreground" />;
}

// A chart failure should show a message, not take the whole page down.
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('ltp chart failed', error); }
  render() {
    return this.state.failed
      ? <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">This chart could not be drawn. The numbers are in the tables.</div>
      : this.props.children;
  }
}

function ChartCard({ title, note, series, guides, height = 220 }: { title: string; note: string; series: Series[]; guides: Guide[]; height?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="flex gap-3 text-[11px] text-muted-foreground">{series.map((s) => <span key={s.title} className="flex items-center gap-1"><i className="inline-block size-2 rounded-full" style={{ background: s.color }} />{s.title}</span>)}</span>
      </div>
      <p className="mb-1 text-[11px] text-muted-foreground">{note}</p>
      <ChartBoundary><LineCanvas series={series} guides={guides} height={height} /></ChartBoundary>
    </div>
  );
}

export function LtpCharts({ analysis, lines0920, only = 'all', height }: { analysis: UsableAnalysis; lines0920: Lines0920 | null; only?: 'all' | 'spot' | 'rest'; height?: number }) {
  const { series: s } = analysis;
  const { coa1, levels } = analysis;
  const val = (l: { value: number | null } | null | undefined) => (l && l.value !== null ? l.value : null);
  const g = (price: number | null, color: string, title: string, style?: LineStyle): Guide[] => (price === null ? [] : [{ price, color, title, style }]);
  const name = (l: { label: string } | null) => (l ? l.label.replace(/ \(.*/, '') : '');
  const l0 = lines0920;
  const guides: Guide[] = [
    // The scenario's own top and bottom reversal levels (solid), then the support / resistance strikes (thin dashed).
    ...g(val(coa1.top), RED, `Top ${name(coa1.top)} (proxy)`, LineStyle.Solid),
    ...g(val(coa1.bottom), GREEN, `Bottom ${name(coa1.bottom)} (proxy)`, LineStyle.Solid),
    ...g(levels.resistance.strike, '#f87171', `Resistance ${levels.resistance.strike}`, LineStyle.Dashed),
    ...g(levels.support.strike, '#4ade80', `Support ${levels.support.strike}`, LineStyle.Dashed),
    // The frozen 9:20 lines (dotted): both profiles' entries, and the stops.
    ...(l0 ? [
      ...g(val(l0.eor), RED, '9:20 EOR (proxy)', LineStyle.Dotted), ...g(val(l0.eorPlus1), '#fb923c', '9:20 EOR+1 (proxy)', LineStyle.Dotted),
      ...g(val(l0.eos), GREEN, '9:20 EOS (proxy)', LineStyle.Dotted), ...g(val(l0.eosMinus1), '#2dd4bf', '9:20 EOS-1 (proxy)', LineStyle.Dotted),
      ...g(l0.profiles.risky.find((e) => e.side === 'short')?.stop ?? null, AMBER, '9:20 stop above', LineStyle.Dotted),
      ...g(l0.profiles.risky.find((e) => e.side === 'long')?.stop ?? null, AMBER, '9:20 stop below', LineStyle.Dotted),
    ] : []),
  ];
  return (
    <div className={only === 'all' ? 'grid gap-3 lg:grid-cols-3' : only === 'rest' ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
      {only !== 'rest' ? <ChartCard height={height} title="Spot with reversal lines" note="Solid: the scenario's top and bottom reversal (proxy). Dashed: support and resistance strikes. Dotted: the frozen 9:20 lines and stops (proxy)." series={[{ color: BLUE, title: 'Spot', points: toPoints(s.spot, (r) => r.spot) }]} guides={guides} /> : null}
      {only !== 'spot' ? <><ChartCard
        title="Weakness %" note={`Second-highest as a percent of the highest. Above ${LTP_CONFIG.weakThresholdPct}% the level is weak.`}
        series={[
          { color: GREEN, title: 'Support vol', points: toPoints(s.pct, (r) => r.supportVolume) }, { color: '#15803d', title: 'Support OI', points: toPoints(s.pct, (r) => r.supportOi) },
          { color: RED, title: 'Resistance vol', points: toPoints(s.pct, (r) => r.resistanceVolume) }, { color: '#b91c1c', title: 'Resistance OI', points: toPoints(s.pct, (r) => r.resistanceOi) },
        ]}
        guides={[{ price: LTP_CONFIG.weakThresholdPct, color: AMBER, title: `${LTP_CONFIG.weakThresholdPct}%` }]}
      />
      <ChartCard
        title="OI at the walls" note="CE OI at resistance and PE OI at support since the open (the COA 2.0 inputs)."
        series={[{ color: RED, title: 'CE OI at resistance', points: toPoints(s.ceOiAtResistance, (r) => r.oi) }, { color: GREEN, title: 'PE OI at support', points: toPoints(s.peOiAtSupport, (r) => r.oi) }]}
        guides={[]}
      /></> : null}
    </div>
  );
}
