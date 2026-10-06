// Port of nice_step in screener/fo_spread_screener.py: the usual strike spacing for a price level (approximate).
export function niceStep(price: number): number {
  return price < 200 ? 5 : price < 1000 ? 10 : price < 2000 ? 20 : price < 5000 ? 50 : 100;
}
