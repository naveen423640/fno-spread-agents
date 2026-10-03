import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, vi } from 'vitest';

import { clearNseReportCaches, discoverCompletedMonthlyCycles, rankHistoricalUniverse } from '@/lib/backtest/nse-data';

const archive = process.env.ORACLE_ARCHIVE_DIR;
const out = process.env.ORACLE_OUT;
const today = process.env.ORACLE_TODAY;
const limit = Number(process.env.ORACLE_LIMIT ?? 50);

// Only runs when the parity test sets the environment; otherwise it is skipped.
describe.skipIf(!archive || !out || !today)('TypeScript oracle dump', () => {
  it('writes cycles and the ranked universe for the same archive the Python engine reads', async () => {
    clearNseReportCaches();
    vi.stubGlobal('fetch', async (url: string) => {
      const match = /BhavCopy_NSE_FO_0_0_0_(\d{8})_F_0000/.exec(String(url));
      const path = match ? join(archive!, 'fo', `${match[1]}.zip`) : '';
      if (!match || !existsSync(path)) return new Response(null, { status: 404 });
      return new Response(readFileSync(path), { status: 200 });
    });
    const cycles = await discoverCompletedMonthlyCycles(today!, 6);
    const universe: Record<string, unknown> = {};
    for (const cycle of cycles) universe[cycle.expiryDate] = rankHistoricalUniverse(cycle, limit);
    writeFileSync(out!, JSON.stringify({ cycles: cycles.map(({ rankingRows: _ignored, ...rest }) => rest), universe }));
  });
});
