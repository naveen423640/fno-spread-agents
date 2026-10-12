'use client';

import type { TodayTrade } from '@/lib/ltp-agent/state';
import { istHhmm } from '@/lib/ltp/time';

export const inr = (v: number) => `${v < 0 ? '-' : ''}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(v))}`;
export const short = (u: string) => u.split(':')[1]?.replace('-INDEX', '') ?? u;
export const colour = (v: number) => (v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : 'text-muted-foreground');

export function TradeCard({ t }: { t: TodayTrade }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3"><strong className="text-sm">{short(t.underlying)} {t.direction.toUpperCase()}</strong><span className="text-muted-foreground">{t.setup} · {istHhmm(t.ts)} IST</span></div>
      <p>{t.reason}</p>
      <p className="tabular-nums text-muted-foreground">Entry {t.entry ?? '–'} · stop {t.stop ?? '–'} · target {t.target ?? '–'} · risk {t.plannedRiskPts?.toFixed(0) ?? '–'} pts · reward {t.rewardPts?.toFixed(0) ?? '–'} pts</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['buy', 'sell'] as const).map((b) => {
          const book = t.books[b];
          if (!book) return <div key={b} className="rounded-md border border-dashed border-border px-2 py-1.5 text-muted-foreground"><strong className="uppercase">{b}</strong> not opened (no usable quote)</div>;
          const value = book.status === 'open' ? book.mtm ?? 0 : book.netPnl ?? 0;
          return (
            <div key={b} className="rounded-md border border-border px-2 py-1.5">
              <div className="flex items-center justify-between"><strong className="uppercase">{b} book</strong><span className={`tabular-nums font-semibold ${colour(value)}`}>{inr(value)} {book.status === 'open' ? 'open (before charges)' : 'net'}</span></div>
              <div className="text-muted-foreground">{book.status === 'closed' ? `closed: ${book.exitReason}` : 'open'} · risk {inr(book.plannedRiskInr)}{book.marginEstimate ? ` · margin ≈ ${inr(book.marginEstimate)} (estimate)` : ''} · <span className={book.fillQuality === 'ltp_fallback' ? 'font-semibold text-amber-600' : ''}>fills: {book.fillQuality === 'quote' ? 'bid/ask' : 'LTP fallback (no quote)'}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
