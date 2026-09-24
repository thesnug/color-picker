import { describe, expect, it } from "vitest";

import {
  pickByAccuracy,
  pickByPrecision,
  pickWeight,
  scoreRanking,
  steps,
  sweep,
  weightRows,
} from "../scripts/jev-evaluation.js";

const accept = (score: number, t: number) => score >= t;

describe("sweep", () => {
  const cases = [
    { score: 0.9, positive: true },
    { score: 0.6, positive: false },
    { score: 0.4, positive: true },
    { score: 0.1, positive: false },
  ];

  it("counts outcomes at each threshold", () => {
    const [low, mid, high] = sweep(cases, [0, 0.5, 0.95], accept);
    expect(low).toMatchObject({ tp: 2, fp: 2, fn: 0, tn: 0, accuracy: 0.5, precision: 0.5, recall: 1 });
    expect(mid).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 1, accuracy: 0.5, precision: 0.5, recall: 0.5 });
    expect(high).toMatchObject({ tp: 0, fp: 0, fn: 2, tn: 2, precision: null, recall: 0 });
  });

  it("supports flagging below a cutoff", () => {
    const [row] = sweep(cases, [0.5], (score, t) => score < t);
    expect(row).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 1 });
  });
});

describe("threshold picks", () => {
  const cases = [
    { score: 0.9, positive: true },
    { score: 0.8, positive: true },
    { score: 0.6, positive: false },
    { score: 0.3, positive: true },
  ];
  const rows = sweep(cases, [0.2, 0.5, 0.7, 0.95], accept);

  it("takes the lowest threshold that is precise enough", () => {
    expect(pickByPrecision(rows, 0.9)?.threshold).toBe(0.7);
  });

  it("falls back to the most precise threshold when none is precise enough", () => {
    expect(pickByPrecision(sweep(cases, [0.2, 0.5], accept), 0.99)?.threshold).toBe(0.2);
  });

  it("takes the most accurate threshold", () => {
    expect(pickByAccuracy(rows)?.threshold).toBe(0.2);
  });
});

describe("scoreRanking", () => {
  it("scores top-1, precision at 3, and reciprocal rank", () => {
    expect(scoreRanking(["A", "B", "C", "D"], ["C", "D"])).toEqual({
      top1: false,
      precisionAt3: 1 / 3,
      reciprocalRank: 1 / 3,
    });
    expect(scoreRanking(["A"], ["A"]).top1).toBe(true);
    expect(scoreRanking(["A"], ["Z"]).reciprocalRank).toBe(0);
  });
});

describe("weights", () => {
  it("averages over designs and prefers the lower weight on a tie", () => {
    const orders = (w: number) => (w < 0.5 ? [["X", "A"], ["B"]] : [["A", "X"], ["B"]]);
    const rows = weightRows([0, 0.4, 0.6, 1], orders, [["A"], ["B"]]);
    expect(rows[0]).toMatchObject({ weight: 0, top1: 0.5, meanReciprocalRank: 0.75 });
    expect(rows[2]).toMatchObject({ weight: 0.6, top1: 1, meanReciprocalRank: 1 });
    expect(pickWeight(rows)?.weight).toBe(0.6);
  });

  it("steps evenly and rounds", () => {
    expect(steps(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(steps(0.1, 0.3, 0.1)).toEqual([0.1, 0.2, 0.3]);
  });
});
