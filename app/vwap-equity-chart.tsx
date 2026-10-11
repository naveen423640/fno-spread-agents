'use client';

import { Component, useEffect, useRef, type ReactNode } from 'react';
import { createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';

const IST_OFFSET = 19_800;

function Canvas({ points }: { points: { t: number; equity: number }[] }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // The chart library cannot parse the app's oklch() theme colours, so it gets plain hex values.
    const dark = document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#d1d5db' : '#374151', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(128,128,128,0.12)' }, horzLines: { color: 'rgba(128,128,128,0.12)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2, priceLineVisible: false });
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    // Several trades can close in the same minute, so keep one point per time (the last), which is the running total after them.
    const byTime = new Map<number, number>();
    for (const p of points) byTime.set(p.t + IST_OFFSET, p.equity);
    seriesRef.current.setData([...byTime.entries()].sort(([a], [b]) => a - b).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    chartRef.current.timeScale().fitContent();
  }, [points]);

  return <div ref={container} className="h-[240px] w-full text-foreground" />;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('equity chart failed', error); }
  render() {
    return this.state.failed ? <div className="flex h-[240px] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">The chart could not be drawn.</div> : this.props.children;
  }
}

export function EquityChart({ points }: { points: { t: number; equity: number }[] }) {
  return <Boundary><Canvas points={points} /></Boundary>;
}
