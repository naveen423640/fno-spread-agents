export type PayoffLeg = {
  optionType: 'CE' | 'PE';
  strike: number;
  side: 1 | -1;
  quantity: number;
  entryPrice: number;
};

export type PayoffRiskMetrics = {
  maxProfit: number | null;
  maxLoss: number | null;
  rewardRisk: number | null;
  breakevens: number[];
  estimatedCapital: number | null;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function expiryPnlAt(underlying: number, legs: PayoffLeg[], lotSize: number) {
  return legs.reduce((sum, leg) => {
    const intrinsic = leg.optionType === 'CE' ? Math.max(underlying - leg.strike, 0) : Math.max(leg.strike - underlying, 0);
    return sum + leg.side * leg.quantity * (intrinsic - leg.entryPrice) * lotSize;
  }, 0);
}

export function calculateRiskMetrics(legs: PayoffLeg[], lotSize: number, costReserve = 0): PayoffRiskMetrics {
  if (!legs.length || !Number.isInteger(lotSize) || lotSize <= 0 || !Number.isFinite(costReserve) || costReserve < 0
    || legs.some((leg) => !['CE', 'PE'].includes(leg.optionType) || ![1, -1].includes(leg.side)
      || !Number.isFinite(leg.strike) || leg.strike <= 0 || !Number.isInteger(leg.quantity) || leg.quantity < 1
      || !Number.isFinite(leg.entryPrice) || leg.entryPrice < 0)) throw new Error('Invalid payoff inputs.');
  const pnlAt = (spot: number) => expiryPnlAt(spot, legs, lotSize) - costReserve;
  const breakpoints = [...new Set([0, ...legs.map((leg) => leg.strike)])].sort((a, b) => a - b);
  const rightSlope = legs.filter((leg) => leg.optionType === 'CE').reduce((sum, leg) => sum + leg.side * leg.quantity, 0);
  const roots: number[] = [];
  const rootPoints = breakpoints;

  for (let index = 0; index < rootPoints.length - 1; index += 1) {
    const left = rootPoints[index];
    const right = rootPoints[index + 1];
    const leftPnl = pnlAt(left);
    const rightPnl = pnlAt(right);
    if (Math.abs(leftPnl) < 0.01) roots.push(left);
    if (leftPnl * rightPnl < 0) roots.push(left + ((0 - leftPnl) * (right - left)) / (rightPnl - leftPnl));
    if (index === rootPoints.length - 2 && Math.abs(rightPnl) < 0.01) roots.push(right);
  }
  const lastStrike = breakpoints.at(-1)!;
  if (rightSlope !== 0) {
    const tailRoot = lastStrike - pnlAt(lastStrike) / (rightSlope * lotSize);
    if (tailRoot >= lastStrike) roots.push(tailRoot);
  }

  const finiteValues = breakpoints.map(pnlAt);
  const maxProfit = rightSlope > 0 ? null : Math.max(...finiteValues);
  const minProfit = rightSlope < 0 ? null : Math.min(...finiteValues);
  const maxLoss = minProfit === null ? null : Math.max(0, -minProfit);
  const rewardRisk = maxProfit !== null && maxLoss !== null && maxLoss > 0 ? maxProfit / maxLoss : null;

  return {
    maxProfit: maxProfit === null ? null : round(maxProfit),
    maxLoss: maxLoss === null ? null : round(maxLoss),
    rewardRisk: rewardRisk === null ? null : round(rewardRisk, 2),
    breakevens: [...new Set(roots.map((value) => round(value, 2)))],
    estimatedCapital: maxLoss === null ? null : round(maxLoss),
  };
}
