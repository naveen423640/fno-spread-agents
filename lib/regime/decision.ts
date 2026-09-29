import { REGIME_CONFIG } from './config';

export type Decision = 'Long candidate' | 'Short candidate' | 'No trade';

export function decide(score: number, theta: number = REGIME_CONFIG.theta): Decision {
  if (score >= theta) return 'Long candidate';
  if (score <= -theta) return 'Short candidate';
  return 'No trade';
}
