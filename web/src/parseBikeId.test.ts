import { describe, expect, it } from "vitest";
import shared from "../../shared/bike-id-cases.json";
import { parseBikeId, toDigits, type OcrLine } from "./parseBikeId";

describe("parseBikeId (shared cases)", () => {
  for (const c of shared.cases) {
    it(c.name, () => {
      const got = parseBikeId(c.lines as OcrLine[], shared.layout);
      expect(got[0] ?? null).toBe(c.expect);
    });
  }
});

describe("toDigits", () => {
  it("does not fabricate digits from words", () => {
    expect(toDigits("YouBike")).toBe("");
    expect(toDigits("YouBike 2.0")).toBe("20");
  });
});
