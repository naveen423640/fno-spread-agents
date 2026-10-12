// Writes an experiment record to experiments/EXP-###.json. Scripts only (the app cannot write files); the database record is the source of truth.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Experiment } from './experiment-types';
import { experimentFileName, serializeExperiment } from './experiments';

export function writeExperimentFile(experiment: Experiment, dir: string = 'experiments'): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, experimentFileName(experiment.id));
  writeFileSync(path, serializeExperiment(experiment));
  return path;
}
