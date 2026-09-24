/**
 * Scoring for the Jev threshold evaluation (scripts/evaluate-jev.ts), kept
 * apart from the live calls so it can be tested without the API.
 *
 * Words to color and recolor plausibility are each read as a binary decision
 * with a score: accept the top color, or flag a swap as implausible. Mood is a
 * ranking against draft agent picks awaiting Jill's review.
 */

/** One labeled case: Jev's score and whether the decision should come out positive. */
export interface Scored {
  score: number;
  positive: boolean;
}

export interface SweepRow {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  accuracy: number;
  /** Null when nothing was predicted positive. */
  precision: number | null;
  /** Null when there are no positive cases. */
  recall: number | null;
}

/**
 * Count outcomes at each threshold. `predict` says whether a score is a
 * positive decision at a threshold: `score >= t` for acceptance, `score < t`
 * for flagging.
 */
export function sweep(
  cases: readonly Scored[],
  thresholds: readonly number[],
  predict: (score: number, threshold: number) => boolean,
): SweepRow[] {
  return thresholds.map((threshold) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const c of cases) {
      const predicted = predict(c.score, threshold);
      if (predicted && c.positive) tp += 1;
      else if (predicted) fp += 1;
      else if (c.positive) fn += 1;
      else tn += 1;
    }
    const n = cases.length;
    return {
      threshold,
      tp,
      fp,
      fn,
      tn,
      accuracy: n === 0 ? 0 : (tp + tn) / n,
      precision: tp + fp === 0 ? null : tp / (tp + fp),
      recall: tp + fn === 0 ? null : tp / (tp + fn),
    };
  });
}

/**
 * The acceptance threshold: the lowest with precision at least `minPrecision`
 * that accepts something, since a wrong answer acted on is worse than a
 * suggestion. Without one, the most precise row, then the higher recall.
 */
export function pickByPrecision(rows: readonly SweepRow[], minPrecision: number): SweepRow | undefined {
  const accepting = rows.filter((r) => r.precision !== null);
  const enough = accepting
    .filter((r) => r.precision! >= minPrecision)
    .sort((a, b) => a.threshold - b.threshold);
  if (enough[0]) return enough[0];
  return [...accepting].sort((a, b) => b.precision! - a.precision! || (b.recall ?? 0) - (a.recall ?? 0))[0];
}

/** The most accurate row; ties go to the higher recall, then the lower threshold. */
export function pickByAccuracy(rows: readonly SweepRow[]): SweepRow | undefined {
  return [...rows].sort(
    (a, b) => b.accuracy - a.accuracy || (b.recall ?? 0) - (a.recall ?? 0) || a.threshold - b.threshold,
  )[0];
}

export interface RankingScore {
  /** True when the first garment is one of the picks. */
  top1: boolean;
  /** Share of the first three garments that are picks. */
  precisionAt3: number;
  /** One over the 1-based position of the first pick, or 0 when no pick appears. */
  reciprocalRank: number;
}

/** Score a garment order against the picks. */
export function scoreRanking(order: readonly string[], picks: readonly string[]): RankingScore {
  const wanted = new Set(picks);
  const first = order.findIndex((name) => wanted.has(name));
  return {
    top1: order[0] !== undefined && wanted.has(order[0]),
    precisionAt3: order.slice(0, 3).filter((name) => wanted.has(name)).length / 3,
    reciprocalRank: first === -1 ? 0 : 1 / (first + 1),
  };
}

export interface WeightRow {
  weight: number;
  top1: number;
  precisionAt3: number;
  meanReciprocalRank: number;
}

/** Average ranking scores per weight, over designs. `orders` maps each weight to one order per design. */
export function weightRows(
  weights: readonly number[],
  orders: (weight: number) => readonly (readonly string[])[],
  picks: readonly (readonly string[])[],
): WeightRow[] {
  return weights.map((weight) => {
    const scores = orders(weight).map((order, i) => scoreRanking(order, picks[i]!));
    const mean = (f: (s: RankingScore) => number) =>
      scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + f(s), 0) / scores.length;
    return {
      weight,
      top1: mean((s) => Number(s.top1)),
      precisionAt3: mean((s) => s.precisionAt3),
      meanReciprocalRank: mean((s) => s.reciprocalRank),
    };
  });
}

/** The weight with the best mean reciprocal rank; ties go to top-1, then the lower weight. */
export function pickWeight(rows: readonly WeightRow[]): WeightRow | undefined {
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return [...rows].sort((a, b) => {
    if (!close(a.meanReciprocalRank, b.meanReciprocalRank)) return b.meanReciprocalRank - a.meanReciprocalRank;
    if (!close(a.top1, b.top1)) return b.top1 - a.top1;
    return a.weight - b.weight;
  })[0];
}

/** Evenly spaced thresholds from `from` to `to`, rounded to two places. */
export function steps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(2)));
  return out;
}
