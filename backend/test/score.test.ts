import { describe, expect, it } from "vitest";
import { isValidScore, weightedScores, weights, type Rating } from "../src/score.js";

const r = (clean: number, gear = clean, frame = clean, userId = "u"): Rating => ({
  clean,
  gear,
  frame,
  userId,
  at: "2026-01-01T00:00:00Z",
});

describe("weights", () => {
  it("newest is 1, oldest is 0.5, linear in between", () => {
    expect(weights(0)).toEqual([]);
    expect(weights(1)).toEqual([1]);
    expect(weights(2)).toEqual([1, 0.5]);
    expect(weights(3)).toEqual([1, 0.75, 0.5]);
    const w10 = weights(10);
    expect(w10[0]).toBe(1);
    expect(w10[9]).toBeCloseTo(0.5);
    expect(w10[1] - w10[2]).toBeCloseTo(0.5 / 9);
  });
});

describe("weightedScores", () => {
  it("returns null when no ratings", () => {
    expect(weightedScores([], 10)).toEqual({ count: 0, scores: null });
  });

  it("single rating is the score itself", () => {
    expect(weightedScores([r(3, 2, 1)], 10)).toEqual({
      count: 1,
      scores: { clean: 3, gear: 2, frame: 1 },
    });
  });

  it("two ratings weigh newest double", () => {
    // (4*1 + 1*0.5) / 1.5 = 3
    expect(weightedScores([r(4), r(1)], 10).scores?.clean).toBe(3);
  });

  it("only uses the newest `window` ratings", () => {
    const list = [...Array(10).fill(r(4)), ...Array(5).fill(r(1))];
    const res = weightedScores(list, 10);
    expect(res.count).toBe(10);
    expect(res.scores).toEqual({ clean: 4, gear: 4, frame: 4 });
  });

  it("newer ratings weigh more", () => {
    const newerGood = weightedScores([r(4), r(4), r(1), r(1)], 10).scores!.clean;
    const newerBad = weightedScores([r(1), r(1), r(4), r(4)], 10).scores!.clean;
    expect(newerGood).toBeGreaterThan(2.5);
    expect(newerBad).toBeLessThan(2.5);
  });
});

describe("isValidScore", () => {
  it("accepts integers 1~4 only", () => {
    expect([1, 2, 3, 4].every(isValidScore)).toBe(true);
    expect([0, 5, 2.5, "3", null, undefined].some(isValidScore)).toBe(false);
  });
});
