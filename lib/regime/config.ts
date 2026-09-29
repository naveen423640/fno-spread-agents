export const REGIME_CONFIG = {
  theta: 0.2, // placeholder, fixed in development
  minLabels: 252,
  volLookback: 60,
  volThreshold: 1.0,
  fixedThreshold: 0.05,
  corporateActionLogMove: 0.25,
  gapCalendarDays: 7,
  recentChanges: 8,
  forecastPathSteps: 10,
} as const;
