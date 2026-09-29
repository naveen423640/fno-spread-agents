export const STATES = ['Bear', 'Sideways', 'Bull'] as const;
export type State = (typeof STATES)[number];
export type Label = State | null;
export type Method = 'vol' | 'fixed';
export const METHODS = ['vol', 'fixed'] as const;
export const WINDOWS = [10, 20, 40, 60] as const;
export type LabelWindow = (typeof WINDOWS)[number];
export const HORIZONS = [1, 5, 10] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Matrix = number[][];
export type Candle = { date: string; close: number };

export class RegimeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegimeInputError';
  }
}
