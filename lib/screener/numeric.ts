// Math helpers the reference gets from Python: math.erf and round() (half to even).

// erf(x) = 2/sqrt(pi) * exp(-x^2) * sum_{n>=0} 2^n x^(2n+1) / (1*3*5*...*(2n+1)). All terms are positive for x > 0,
// so the series is numerically stable; erf(6) is already 1 to double precision.
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  if (a >= 6) return sign;
  let term = a;
  let sum = a;
  for (let n = 1; n < 200; n += 1) {
    term *= (2 * a * a) / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sign * ((2 / Math.sqrt(Math.PI)) * Math.exp(-a * a) * sum);
}

// Python round(x, digits): exact ties go to the even neighbour, everything else rounds on the true binary value.
// Ties are found from the exact decimal expansion of the double, not from x * 10^digits, which can round to a false tie
// (2.675 * 100 is exactly 267.5 in floating point although 2.675 is really 2.67499999999999982...).
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const exact = a.toFixed(Math.min(100, digits + 60));
  const dot = exact.indexOf('.');
  const head = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  const keptFrac = frac.slice(0, digits);
  const isTie = /^50*$/.test(frac.slice(digits));
  if (isTie) {
    const lastKept = digits > 0 ? keptFrac.slice(-1) : head.slice(-1);
    if (Number(lastKept) % 2 === 0) return sign * Number(digits > 0 ? `${head}.${keptFrac}` : head);
  }
  return sign * Number(a.toFixed(digits));
}
