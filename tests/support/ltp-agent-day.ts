import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { createLtpStore } from '@/lib/ltp/store';
import { istTs } from '@/lib/ltp/time';
import type { Snapshot } from '@/lib/ltp/types';
import { createD1Fake } from './d1-fake';
import { makeChain } from './ltp-chain';

export const U = 'NSE:NIFTY50-INDEX';
export const DAY = '2026-10-12';
const STRIKES = Array.from({ length: 23 }, (_, i) => 23400 + i * 50);

// A NIFTY chain with a put wall at 23900 and a call wall at 24200 (so EOS is 23860 and EOR 24255 under writer breakeven), quoted 0.05 either side of LTP.
export function chainAt(hhmm: string, spot: number, date = DAY): Snapshot {
  const s = makeChain({
    spot, step: 50, strikes: STRIKES, ts: istTs(date, hhmm), underlying: U, expiry: '2026-10-13',
    pe: { 23900: { volume: 9000, oi: 9000, ltp: 40 }, 23850: { ltp: 30 }, 23800: { ltp: 25 } },
    ce: { 24200: { volume: 9000, oi: 9000, ltp: 55 }, 24250: { ltp: 45 }, 24300: { ltp: 35 } },
  });
  return { ...s, rows: s.rows.map((r) => (r.ltp === null ? r : { ...r, bid: r.ltp - 0.05, ask: r.ltp + 0.05 })) };
}

export const minutes = (from: string, to: string): string[] => {
  const out: string[] = [];
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  for (let m = fh * 60 + fm; m <= th * 60 + tm; m += 1) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return out;
};

// [time, spot] pairs. Everything before the first pair is flat at 24037.
export function pathDay(points: [string, number][], flatFrom = '09:15', date = DAY): Snapshot[] {
  const first = points[0][0];
  const flat = minutes(flatFrom, first).slice(0, -1).map((t) => chainAt(t, 24037, date));
  return [...flat, ...points.map(([t, spot]) => chainAt(t, spot, date))];
}

export const freshStores = () => ({
  store: createLtpStore(createD1Fake(['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql'])),
  journal: createJournalStore(createD1Fake(['drizzle/0010_ltp_agent.sql'])),
});
