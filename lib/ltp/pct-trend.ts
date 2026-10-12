// The "game of percentage" (course ch12 and ch13): whether a weak side's percentage is rising or falling is itself a pressure signal.
//   WTB: rising is bearish, falling is bullish.   WTT: rising is bullish, falling is bearish.
// Read over the last lookback minutes. The window and the flat band are my own parameters (the course gives none). Pure.
import { LTP_CONFIG, type LtpConfig } from './config';
import type { Status } from './types';

export type PctTrend = { trend: 'rising' | 'falling' | 'flat'; bias: 'bullish' | 'bearish' | 'neutral'; from: number; to: number };

// `points` hold the weak percentage of the side's weak metric at each snapshot (null where the side was not weak that way).
export function pctTrend(points: { ts: number; pct: number | null }[], status: Status, now: number, cfg: LtpConfig = LTP_CONFIG): PctTrend | null {
  if (status === 'strong') return null;
  const from = now - cfg.pctTrend.lookbackMin * 60;
  const inside = points.filter((p): p is { ts: number; pct: number } => p.pct !== null && p.ts >= from && p.ts <= now).sort((a, b) => a.ts - b.ts);
  if (inside.length < 2) return null;
  const start = inside[0].pct;
  const end = inside[inside.length - 1].pct;
  const change = end - start;
  if (Math.abs(change) < cfg.pctTrend.minChangePoints) return { trend: 'flat', bias: 'neutral', from: start, to: end };
  const rising = change > 0;
  const bullish = status === 'wtt' ? rising : !rising;
  return { trend: rising ? 'rising' : 'falling', bias: bullish ? 'bullish' : 'bearish', from: start, to: end };
}
