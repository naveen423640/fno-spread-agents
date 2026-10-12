// Strategies on disk: strategies/ltp_vX.Y.yaml. Server side and scripts only (reads the file system).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseStrategy, type Strategy } from './strategy';

export const STRATEGY_DIR = 'strategies';

export function listStrategyVersions(dir: string = STRATEGY_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => { const m = /^ltp_v(\d+\.\d+)\.yaml$/.exec(name); return m ? [m[1]] : []; })
    .sort((a, b) => { const [am, an] = a.split('.').map(Number); const [bm, bn] = b.split('.').map(Number); return am - bm || an - bn; });
}

export function readStrategyFile(version: string, dir: string = STRATEGY_DIR): Strategy {
  const path = join(dir, `ltp_v${version}.yaml`);
  if (!existsSync(path)) throw new Error(`Strategy version ${version} not found (${path}).`);
  return parseStrategy(readFileSync(path, 'utf8'));
}
