// Every tunable number for the OrderBlock Board lives here, with what it means and why the default was picked.
// Defaults are judgement calls, not fitted values: the Phase 3 backtest is the place to test whether they add any edge.

export const BOARD_CONFIG = {
  poll: {
    intervalSeconds: 60, // one poll per minute while the cash session is open
    quoteBatchSize: 50, // FYERS accepts up to 50 symbols per quotes request
    quoteGapMs: 300, // pause between quote batches (about 3 requests per second, under the 10 per second limit)
    baselinesPerPoll: 30, // daily-candle baselines fetched per poll until every symbol has one (about 400 ms each)
    oiPerPoll: 40, // futures OI refreshed per poll, oldest first, so every stock is refreshed about every five minutes
    historyGapMs: 400, // pause after each history call to stay under the FYERS request limit
  },

  baseline: {
    atrPeriod: 14, // daily ATR period used to normalise the move
    volumeDays: 20, // days averaged for the volume baseline
    dailyHistoryDays: 45, // calendar days of daily candles requested (covers 20 sessions plus ATR warm-up)
  },

  // Cumulative share of a normal session's volume traded by each minute after the 09:15 open (minutes, fraction).
  // ASSUMPTION: a typical U-shaped NSE profile (heavy open, quiet midday, busier close). These numbers are approximate and
  // not measured from your data. They are only used until `sameTimeHistory.minSessions` recorded sessions exist.
  volumeProfile: [
    [0, 0], [15, 0.12], [30, 0.2], [60, 0.31], [90, 0.4], [120, 0.47], [150, 0.53],
    [180, 0.6], [210, 0.67], [240, 0.76], [270, 0.85], [300, 0.93], [330, 0.98], [375, 1],
  ] as [number, number][],
  sameTimeHistory: { minSessions: 5, maxSessions: 20 }, // use recorded same-time volume once this many sessions exist

  // The score is a weighted sum of four components, each scaled to -1..+1, times 100. Weights sum to 1.
  weights: { move: 0.4, volume: 0.2, oi: 0.25, sector: 0.15 },

  move: {
    capAtrMultiple: 3, // a move of this many daily ATRs scores the maximum on the move component
    minAtrToRank: 0.25, // a stock that has moved less than this many daily ATRs either way is not a setup, whatever its OI or volume say
  },
  volume: { fullScoreRatio: 3 }, // cumulative volume at this multiple of normal scores the maximum; at or below 1x scores zero
  oi: {
    fullScoreChangePct: 5, // futures OI change (vs previous day) at this percentage scores the maximum
    coverUnwindFactor: 0.3, // short covering and long unwinding count for this fraction of a fresh build-up
  },
  sector: { fullScoreMovePct: 1 }, // sector index move (same direction as the stock) that scores the maximum

  // Choppy filter: a stock that fails either test scores zero, so it never makes the board.
  chop: {
    minMinutesElapsed: 30, // do not judge choppiness before this many minutes into the session
    maxVwapCrossings: 4, // price crossing its own VWAP (average traded price) this many times or more
    maxOpenCrossings: 4, // price crossing today's open this many times or more
    minRangeAtrFraction: 0.35, // day range as a share of the daily ATR; smaller than this is "too quiet"
  },

  // Support/resistance, liquidity and order-block detection for the detail chart. All distances are percent of price.
  zones: {
    intraday: { resolution: '5', calendarDays: 8 }, // 5-minute candles, about five sessions
    daily: { calendarDays: 120 },
    pivotLookback: { intraday: 5, daily: 3 }, // a swing point beats this many candles on each side (5 five-minute candles is 25 minutes)
    levelTolerancePct: 0.25, // swing points within this distance are merged into one level
    minLevelWeight: 2, // a level needs this much weight: a daily swing counts 2, an intraday swing 1
    levelsPerSide: 2, // nearest support and resistance levels shown
    equalTolerancePct: 0.1, // swing highs (or lows) this close count as "equal" liquidity
    equalMinPoints: 2,
    equalLookbackCandles: 160, // only swings from the last ~two sessions of 5-minute candles count
    equalPerSide: 2, // equal highs are kept only above the price and equal lows only below it (liquidity not yet taken), nearest first
    orderBlock: {
      atrPeriod: 14, // 5-minute ATR used to size an impulse
      impulseAtrMultiple: 1.5, // the move after the candle must exceed this many 5-minute ATRs
      impulseWindow: 3, // ...within this many candles
      zone: 'range', // 'range' = candle low to high; 'body' = open to close
      maxPerSide: 3,
      maxDistancePct: 4, // order blocks further than this from the current price are left out; they are too far to act on
    },
  },

  board: { topN: 20, minAbsScore: 10 }, // list size, and the smallest score that counts as a setup at all
} as const;

export type BoardConfig = typeof BOARD_CONFIG;
