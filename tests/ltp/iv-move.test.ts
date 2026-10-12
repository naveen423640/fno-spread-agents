import { describe, expect, it } from 'vitest';

import { EXTENSION_METHODS, ivMove, writerBreakeven } from '@/lib/ltp/extensions';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';

// Captured 2026-10-12 about 10:30 IST from the real tool (NIFTY, expiry 13-10-2026) next to our stored LTPs at 10:30:00 (spot 22466.85).
// [strike, side, our LTP, the tool's reversal price]
const CAPTURED: [number, 'CE' | 'PE', number, number][] = [
  [22150, 'PE', 16.75, 22128.6], [22200, 'PE', 22.45, 22177], [22250, 'PE', 29.95, 22228.25], [22300, 'PE', 40, 22277.2], [22350, 'PE', 53, 22326.55], [22400, 'PE', 70.1, 22376.75], [22450, 'PE', 90.15, 22426.3],
  [22450, 'CE', 104.05, 22476.7], [22500, 'CE', 78.85, 22525.4], [22550, 'CE', 58.55, 22575.3], [22600, 'CE', 42.35, 22625.7], [22650, 'CE', 29.95, 22674], [22700, 'CE', 21.15, 22725.95], [22750, 'CE', 14.4, 22774.15],
];
const SNAP_TS = istTs('2026-10-12', '10:30');
const snapshot = () => makeChain({
  spot: 22466.85, step: 50, ts: SNAP_TS, expiry: '2026-10-13', strikes: [...new Set(CAPTURED.map((c) => c[0]))],
  ce: Object.fromEntries(CAPTURED.filter((c) => c[1] === 'CE').map((c) => [c[0], { ltp: c[2] }])),
  pe: Object.fromEntries(CAPTURED.filter((c) => c[1] === 'PE').map((c) => [c[0], { ltp: c[2] }])),
});

describe('ivMove: EOS/EOR as strike plus or minus a fraction of the one-sigma move left to expiry', () => {
  const s = snapshot();

  it('is registered next to the other methods and labelled as a proxy method', () => {
    expect(EXTENSION_METHODS.map((m) => m.id)).toContain('iv_move');
    expect(ivMove.label).toMatch(/iv/i);
  });

  it('is within about 2 points of the real tool on average for the 14 near-the-money strikes captured at 10:30', () => {
    const errors = CAPTURED.map(([strike, side, , real]) => Math.abs(ivMove.reversal(s, strike, side)! - real));
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mae).toBeLessThan(2);
    expect(Math.max(...errors)).toBeLessThan(4);
  });

  it('is far closer than writer breakeven, which is 60 points off at the money', () => {
    const real = 22426.3;
    expect(Math.abs(writerBreakeven.reversal(s, 22450, 'PE')! - real)).toBeGreaterThan(30);
    expect(Math.abs(ivMove.reversal(s, 22450, 'PE')! - real)).toBeLessThan(4);
  });

  it('puts go below the strike, calls above, and the extension stays under one strike step near the money', () => {
    expect(ivMove.reversal(s, 22450, 'PE')!).toBeLessThan(22450);
    expect(ivMove.reversal(s, 22450, 'PE')!).toBeGreaterThan(22400);
    expect(ivMove.reversal(s, 22600, 'CE')!).toBeGreaterThan(22600);
    expect(ivMove.reversal(s, 22600, 'CE')!).toBeLessThan(22650);
  });

  it('gives null, never a made-up number, when the LTP is missing or below intrinsic value, or the expiry has passed', () => {
    const missing = makeChain({ spot: 22466.85, step: 50, ts: SNAP_TS, expiry: '2026-10-13', pe: { 22450: { ltp: null } } });
    expect(ivMove.reversal(missing, 22450, 'PE')).toBeNull();
    const glitch = makeChain({ spot: 22466.85, step: 50, ts: SNAP_TS, expiry: '2026-10-13', ce: { 22450: { ltp: 1 } } }); // intrinsic is 16.85
    expect(ivMove.reversal(glitch, 22450, 'CE')).toBeNull();
    const expired = makeChain({ spot: 22466.85, step: 50, ts: istTs('2026-10-14', '10:00'), expiry: '2026-10-13' });
    expect(ivMove.reversal(expired, 22450, 'PE')).toBeNull();
  });
});
