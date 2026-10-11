'use client';

import { Component, useEffect, useRef, type ReactNode } from 'react';
import { CandlestickSeries, createChart, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesPrimitive, type IPrimitivePaneRenderer, type IPrimitivePaneView, type SeriesAttachedParameter, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

import type { ZonesPayload } from '@/lib/board/types';

const IST_OFFSET = 19_800; // lightweight-charts draws UTC, so shifting by +5:30 makes the time axis read in IST
const GREEN = '#22c55e';
const RED = '#ef4444';

type Box = { top: number; bottom: number; from: number; bull: boolean };

// Draws order-block boxes from the candle that formed them to the right edge of the chart, behind the candles.
class BoxPrimitive implements ISeriesPrimitive<Time> {
  private param: SeriesAttachedParameter<Time> | null = null;
  private boxes: Box[] = [];
  setBoxes(boxes: Box[]) { this.boxes = boxes; this.param?.requestUpdate(); }
  attached(param: SeriesAttachedParameter<Time>) { this.param = param; }
  detached() { this.param = null; }
  updateAllViews() { /* boxes are converted to pixels at draw time */ }
  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: CanvasRenderingTarget2D) => {
        const param = this.param;
        if (!param) return;
        target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
          const series = param.series;
          for (const box of this.boxes) {
            const y1 = series.priceToCoordinate(box.top);
            const y2 = series.priceToCoordinate(box.bottom);
            if (y1 === null || y2 === null) continue;
            const x = param.chart.timeScale().timeToCoordinate(box.from as UTCTimestamp);
            const left = x === null ? 0 : Math.max(0, x * horizontalPixelRatio);
            const top = Math.min(y1, y2) * verticalPixelRatio;
            const height = Math.max(2, Math.abs(y2 - y1) * verticalPixelRatio);
            context.fillStyle = box.bull ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
            context.strokeStyle = box.bull ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';
            context.lineWidth = Math.max(1, horizontalPixelRatio);
            context.fillRect(left, top, bitmapSize.width - left, height);
            context.strokeRect(left, top, bitmapSize.width - left, height);
          }
        });
      },
    };
    return [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }
}

export type ChartLayers = { levels: boolean; liquidity: boolean; blocks: boolean };

function ChartCanvas({ data, layers }: { data: ZonesPayload; layers: ChartLayers }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const boxesRef = useRef<BoxPrimitive | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // The chart library cannot parse the app's oklch() theme colours, so it gets plain hex values.
    const dark = document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    const text = dark ? '#d1d5db' : '#374151';
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: text, fontSize: 11 },
      grid: { vertLines: { color: 'rgba(128,128,128,0.12)' }, horzLines: { color: 'rgba(128,128,128,0.12)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: GREEN, downColor: RED, wickUpColor: GREEN, wickDownColor: RED, borderVisible: false });
    const boxes = new BoxPrimitive();
    series.attachPrimitive(boxes);
    chartRef.current = chart; seriesRef.current = series; boxesRef.current = boxes;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; boxesRef.current = null; linesRef.current = []; };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    series.setData(data.candles.map((c) => ({ time: (c.t + IST_OFFSET) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];
    const add = (price: number, color: string, title: string, style: LineStyle) => { linesRef.current.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })); };
    if (layers.levels) {
      for (const s of data.zones.supports) add(s.price, GREEN, 'S', LineStyle.Dashed);
      for (const r of data.zones.resistances) add(r.price, RED, 'R', LineStyle.Dashed);
    }
    if (layers.liquidity) for (const l of data.zones.liquidity) add(l.price, l.kind.startsWith('equal') ? '#f59e0b' : '#3b82f6', l.label, LineStyle.Dotted);
    boxesRef.current?.setBoxes((layers.blocks ? data.zones.orderBlocks : []).map((b) => ({ top: b.top, bottom: b.bottom, from: b.t + IST_OFFSET, bull: b.side === 'bull' })));
    chart.timeScale().fitContent();
  }, [data, layers]);

  return <div ref={container} className="h-[340px] w-full text-foreground" />;
}

// A chart failure should show a message, not take the whole page down.
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('board chart failed', error); }
  render() {
    return this.state.failed
      ? <div className="flex h-[340px] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">The chart could not be drawn. The levels are listed in the summary below.</div>
      : this.props.children;
  }
}

export function BoardChart({ data, layers }: { data: ZonesPayload; layers: ChartLayers }) {
  return <ChartBoundary><ChartCanvas data={data} layers={layers} /></ChartBoundary>;
}
