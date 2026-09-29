import type { RegimeAnalysis } from './analyze';

export type RegimeResponse = {
  symbol: string;
  analysis: RegimeAnalysis;
  dataSource: {
    provider: 'FYERS';
    resolution: 'daily';
    fetchedAt: string;
    lastCandleDate: string | null;
    expectedLastSession: string;
    stale: boolean;
    staleNote: string | null;
    adjustment: 'unverified' | 'adjusted' | 'unadjusted';
    adjustmentNote: string;
  };
};

export type RegimeErrorResponse = { error: string; code: 'NO_TOKEN' | 'TOKEN_REJECTED' | 'BAD_REQUEST' | 'NO_DATA' | 'UPSTREAM' };
