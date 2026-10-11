'use client';

import { Component, useEffect, useRef, type ReactNode } from 'react';
import { CandlestickSeries, createChart, createSeriesMarkers, LineSeries, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';

const IST_OFFSET = 19_800; // lightweight-charts draws UTC, so +5:30 makes the time axis read in IST

export type VwapChartDay = {
  day: string;
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  vwap: (number | null)[];
  events: { t: number; direction: 'up' | 'down'; type: string; borderline: boolean }[];
};

function Canvas({ days }: { days: VwapChartDay[] }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

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
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', borderVisible: false });
    const vwap = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'Month VWAP' });
    chartRef.current = chart; candlesRef.current = candles; vwapRef.current = vwap;
    markersRef.current = createSeriesMarkers(candles, []);
    return () => { chart.remove(); chartRef.current = null; candlesRef.current = null; vwapRef.current = null; markersRef.current = null; };
  }, []);

  useEffect(() => {
    if (!candlesRef.current || !vwapRef.current || !chartRef.current) return;
    const all = days.flatMap((d) => d.candles.map((c, i) => ({ c, v: d.vwap[i] })));
    candlesRef.current.setData(all.map(({ c }) => ({ time: (c.t + IST_OFFSET) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    vwapRef.current.setData(all.flatMap(({ c, v }) => (v === null ? [] : [{ time: (c.t + IST_OFFSET) as UTCTimestamp, value: v }])));
    const markers: SeriesMarker<Time>[] = days.flatMap((d) => d.events.map((e) => ({
      time: (e.t + IST_OFFSET) as UTCTimestamp,
      position: e.direction === 'up' ? ('belowBar' as const) : ('aboveBar' as const),
      color: e.direction === 'up' ? '#22c55e' : '#ef4444',
      shape: e.direction === 'up' ? ('arrowUp' as const) : ('arrowDown' as const),
      text: e.borderline ? '~' : '',
    })));
    markersRef.current?.setMarkers(markers);
    chartRef.current.timeScale().fitContent();
  }, [days]);

  return <div ref={container} className="h-[320px] w-full text-foreground" />;
}

// A chart failure should show a message, not take the whole page down.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('vwap chart failed', error); }
  render() {
    return this.state.failed
      ? <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">The chart could not be drawn. The cross list is below.</div>
      : this.props.children;
  }
}

export function VwapChart({ days }: { days: VwapChartDay[] }) {
  return <Boundary><Canvas days={days} /></Boundary>;
}
