import { describe, it, expect } from "vitest";
import { computeFontSize, FONT_RATIOS, computeAllFontSizes } from "../fontScale.ts";

describe("computeFontSize", () => {
  it("returns base for body step", () => {
    expect(computeFontSize(13, "body")).toBe(13);
  });

  it("computes sm step at base 13", () => {
    expect(computeFontSize(13, "sm")).toBe(10); // 13 * 0.77 = 10.01 → 10
  });

  it("computes lg step at base 13", () => {
    expect(computeFontSize(13, "lg")).toBe(12); // 13 * 0.92 = 11.96 → 12
  });

  it("computes md step at compact base 9", () => {
    expect(computeFontSize(9, "md")).toBe(8); // 9 * 0.85 = 7.65 → 8
  });

  it("defaults to body ratio for unknown step", () => {
    expect(computeFontSize(13, "unknown")).toBe(13);
  });
});

describe("computeAllFontSizes", () => {
  it("returns all steps at base 13", () => {
    const sizes = computeAllFontSizes(13);
    expect(sizes.body).toBe(13);
    expect(sizes.sm).toBe(10);
    expect(sizes.lg).toBe(12);
    expect(sizes.xl).toBe(17);
  });
});

describe("FONT_RATIOS", () => {
  it("has body ratio of 1.0", () => {
    expect(FONT_RATIOS.body).toBe(1.0);
  });

  it("has 7 steps", () => {
    expect(Object.keys(FONT_RATIOS)).toHaveLength(7);
  });
});
