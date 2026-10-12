'use client';

import { Component, useEffect, useRef, type ReactNode } from 'react';
import { createChart, LineSeries, type UTCTimestamp } from 'lightweight-charts';

const IST_OFFSET = 19_800;
export type ChartSeries = { title: string; color: string; points: { ts: number; value: number }[] };

// Line charts for the Agent tab. Plain hex colours (the chart library cannot parse the app's oklch theme colours) and an error boundary around it.
function Canvas({ series, height }: { series: ChartSeries[]; height: number }) {
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
    for (const s of series) {
      const line = chart.addSeries(LineSeries, { color: s.color, lineWidth: 2, title: s.title, priceLineVisible: false });
      // The chart needs strictly increasing times: trades that close in the same second are nudged apart by a second.
      let last = 0;
      line.setData(s.points.map((p) => { const t = Math.max(p.ts + IST_OFFSET, last + 1); last = t; return { time: t as UTCTimestamp, value: p.value }; }));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series]);
  return <div ref={container} style={{ height }} className="w-full text-foreground" />;
}

class Boundary extends Component<{ children: ReactNode; height: number }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('agent chart failed', error); }
  render() {
    return this.state.failed
      ? <div style={{ height: this.props.height }} className="flex items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">The chart could not be drawn. The numbers are in the tables.</div>
      : this.props.children;
  }
}

export function LineChart({ series, height = 240, empty = 'Nothing to chart yet.' }: { series: ChartSeries[]; height?: number; empty?: string }) {
  if (!series.some((s) => s.points.length)) return <div style={{ height }} className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">{empty}</div>;
  return <Boundary height={height}><Canvas series={series} height={height} /></Boundary>;
}
