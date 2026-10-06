import { bs } from '../backtest';
import { expiryParts, fyersEquity, fyersIndex, fyersOption } from '../symbols';
import type { BrokerResult, Candle, Quote } from '../types';
import type { BrokerAdapter, DateRange, OptionKind } from './types';

// Broker adapter over synthetic data, for dry runs and tests. Option quotes are modelled with Black-Scholes at a fixed IV.
export type MockDeps = { data: Record<string, Candle[]>; bench: Candle[]; lots?: Record<string, number>; defaultLot?: number };

const OPTION_SYMBOL = /^NSE:(.+?)(\d{2})([A-Z]{3})(\d+(?:\.\d+)?)(CE|PE)$/;

export function createMockAdapter(deps: MockDeps): BrokerAdapter {
  const tickerOf = (symbol: string) => symbol.replace(/^NSE:/, '').replace(/-EQ$/, '');

  async function history(symbol: string, range: DateRange): Promise<BrokerResult<Candle[]>> {
    const candles = symbol === fyersIndex() ? deps.bench : deps.data[tickerOf(symbol)];
    if (!candles) return { ok: false, code: 'NOT_FOUND', message: `${symbol} is not in the synthetic data.` };
    return { ok: true, value: candles.filter((c) => c.date >= range.from && c.date <= range.to) };
  }

  async function quote(symbol: string): Promise<BrokerResult<Quote>> {
    const option = OPTION_SYMBOL.exec(symbol);
    if (!option) {
      const candles = deps.data[tickerOf(symbol)];
      if (!candles) return { ok: false, code: 'NOT_FOUND', message: `${symbol} is not in the synthetic data.` };
      const close = candles[candles.length - 1].close;
      return { ok: true, value: { bid: close * 0.9995, ask: close * 1.0005, ltp: close, oi: null } };
    }
    const candles = deps.data[option[1]];
    if (!candles) return { ok: false, code: 'NOT_FOUND', message: `${option[1]} is not in the synthetic data.` };
    const spot = candles[candles.length - 1].close;
    const price = bs(spot, Number(option[4]), 25 / 252, 0.3, option[5] === 'CE');
    return { ok: true, value: { bid: price * 0.995, ask: price * 1.005, ltp: price, oi: 10_000 } };
  }

  return {
    name: 'mock',
    equitySymbol: fyersEquity,
    indexSymbol: fyersIndex,
    optionSymbol(underlying, expiryIso, strike, kind: OptionKind) {
      const { yy, mon } = expiryParts(expiryIso);
      return fyersOption(underlying, yy, mon, strike, kind);
    },
    history,
    quote,
    async lotSize(underlying) {
      const lot = deps.lots?.[underlying] ?? deps.defaultLot;
      return lot ? { ok: true, value: lot } : { ok: false, code: 'NOT_FOUND', message: `No lot size for ${underlying}.` };
    },
    async optionOi() {
      return { ok: true, value: 10_000 };
    },
  };
}
