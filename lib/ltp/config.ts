// Every threshold of the LTP Levels engine, in one place. The brief gives some of these numbers (marked "brief"); the rest are my own
// parameters because the method publishes no number (marked "assumed"). Nothing here is fitted to data.

export type SocRange = { minutes: number; rangeMin: number; rangeMax: number };

export type LtpConfig = {
  weakThresholdPct: number; // brief: second-highest / highest above this percent makes a level Weak (75 itself is still Strong)
  strikecount: number; // brief: strikes requested around the money from the option chain
  expectedStep: Record<string, number>; // brief: expected strike step per underlying; a different derived step only logs a warning
  lotSize: Record<string, number>; // display only: the real tool shows OI and volume in lots
  hitTolerancePoints: number; // assumed: a price within this many points of a reversal level counts as touching it
  coa2: {
    stableBandPct: number; // assumed: an OI change within +/- this percent over the lookback is "stable"
    lookbackMin: number; // assumed: minutes over which the OI change is measured
    windowStart: string; // brief: COA 2.0 is valid from this IST time
    windowEnd: string; // brief: ...until this IST time
  };
  soc: {
    oneHour: SocRange; // brief: pct spread of 2 to 5 points for more than 60 minutes, no shift
    twoHour: SocRange; // brief: spread of 10 to 15 points for 120 minutes, no shift
    threeHour: { minutes: number }; // brief: shifted and weak again for more than 180 minutes
  };
  lines0920: {
    time: string; // brief: the first snapshot at or after this IST time freezes the lines
    stopBufferPoints: number; // brief: points added beyond EOR+2 / EOS-2 for the stop
  };
  recorder: { intervalSeconds: number; start: string; end: string }; // brief: every 60 s from 09:15:00 to 15:30:00 IST
};

export const LTP_CONFIG: LtpConfig = {
  weakThresholdPct: 75,
  strikecount: 20,
  expectedStep: { 'NSE:NIFTY50-INDEX': 50, 'NSE:NIFTYBANK-INDEX': 100, 'BSE:SENSEX-INDEX': 100 },
  lotSize: { 'NSE:NIFTY50-INDEX': 65, 'NSE:NIFTYBANK-INDEX': 30, 'BSE:SENSEX-INDEX': 20 },
  hitTolerancePoints: 5,
  coa2: { stableBandPct: 5, lookbackMin: 30, windowStart: '09:45', windowEnd: '14:30' },
  soc: {
    oneHour: { minutes: 60, rangeMin: 2, rangeMax: 5 },
    twoHour: { minutes: 120, rangeMin: 10, rangeMax: 15 },
    threeHour: { minutes: 180 },
  },
  lines0920: { time: '09:20', stopBufferPoints: 10 },
  recorder: { intervalSeconds: 60, start: '09:15:00', end: '15:30:00' },
};
