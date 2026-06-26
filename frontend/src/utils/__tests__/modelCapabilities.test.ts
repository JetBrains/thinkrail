import { describe, it, expect } from "vitest";
import {
  effortOptionsForModel,
  flagsForModel,
  modelSupportsEffort,
  modelLabel,
  planModelSwitch,
  describeModelSwitch,
  CONTEXT_1M_FLAG,
} from "../modelCapabilities.ts";
import type { RuntimeCapabilities } from "@/types/rpc-methods.ts";

const CAPS: RuntimeCapabilities = {
  permissionModes: [{ value: "default", label: "default" }],
  effortLevels: [
    { value: "auto", label: "auto" },
    { value: "low", label: "low" },
    { value: "medium", label: "medium" },
    { value: "high", label: "high" },
    { value: "xhigh", label: "xhigh" },
    { value: "max", label: "max" },
  ],
  models: [
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  ],
  flags: [
    { key: CONTEXT_1M_FLAG, label: "1M context window", type: "boolean", default: true },
  ],
  modelCapabilities: [
    {
      model: "claude-opus-4-8",
      effortLevels: ["auto", "low", "medium", "high", "xhigh", "max"],
      flags: [CONTEXT_1M_FLAG],
    },
    {
      model: "claude-sonnet-4-6",
      effortLevels: ["auto", "low", "medium", "high", "max"],
      flags: [CONTEXT_1M_FLAG],
    },
    { model: "claude-haiku-4-5-20251001", effortLevels: ["auto"], flags: [] },
  ],
};

const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-4-8";
const SONNET = "claude-sonnet-4-6";

describe("effortOptionsForModel", () => {
  it("offers only auto for Haiku", () => {
    expect(effortOptionsForModel(CAPS, HAIKU).map((e) => e.value)).toEqual(["auto"]);
  });

  it("offers the full set for Opus", () => {
    expect(effortOptionsForModel(CAPS, OPUS).map((e) => e.value)).toEqual([
      "auto", "low", "medium", "high", "xhigh", "max",
    ]);
  });

  it("drops xhigh for Sonnet", () => {
    const values = effortOptionsForModel(CAPS, SONNET).map((e) => e.value);
    expect(values).not.toContain("xhigh");
    expect(values).toEqual(["auto", "low", "medium", "high", "max"]);
  });

  it("returns the full list for an unconstrained (unknown) model", () => {
    expect(effortOptionsForModel(CAPS, "legacy-model").map((e) => e.value)).toEqual([
      "auto", "low", "medium", "high", "xhigh", "max",
    ]);
  });
});

describe("flagsForModel", () => {
  it("hides the 1M flag on Haiku", () => {
    expect(flagsForModel(CAPS, HAIKU)).toEqual([]);
  });

  it("keeps the 1M flag on Opus", () => {
    expect(flagsForModel(CAPS, OPUS).map((f) => f.key)).toEqual([CONTEXT_1M_FLAG]);
  });
});

describe("modelSupportsEffort", () => {
  it("auto is always supported", () => {
    expect(modelSupportsEffort(CAPS, HAIKU, "auto")).toBe(true);
    expect(modelSupportsEffort(CAPS, HAIKU, null)).toBe(true);
  });

  it("rejects xhigh on Haiku and Sonnet", () => {
    expect(modelSupportsEffort(CAPS, HAIKU, "xhigh")).toBe(false);
    expect(modelSupportsEffort(CAPS, SONNET, "xhigh")).toBe(false);
  });

  it("accepts xhigh on Opus", () => {
    expect(modelSupportsEffort(CAPS, OPUS, "xhigh")).toBe(true);
  });
});

describe("planModelSwitch", () => {
  it("conflicts switching Opus(xhigh,1M) → Haiku, noting both downgrades", () => {
    const plan = planModelSwitch(CAPS, HAIKU, "xhigh", { [CONTEXT_1M_FLAG]: true });
    expect(plan.hasConflict).toBe(true); // effort can't change live
    expect(plan.effortReset).toBe(true);
    expect(plan.contextCapped).toBe(true);
    expect(plan.clampedEffort).toBe("auto");
  });

  it("conflicts on effort switching Opus(xhigh) → Sonnet (both support 1M)", () => {
    const plan = planModelSwitch(CAPS, SONNET, "xhigh", { [CONTEXT_1M_FLAG]: true });
    expect(plan.hasConflict).toBe(true);
    expect(plan.effortReset).toBe(true);
    expect(plan.contextCapped).toBe(false);
    expect(plan.clampedEffort).toBe("auto");
  });

  it("no conflict switching Sonnet(high) → Opus", () => {
    const plan = planModelSwitch(CAPS, OPUS, "high", { [CONTEXT_1M_FLAG]: true });
    expect(plan.hasConflict).toBe(false);
    expect(plan.clampedEffort).toBe("high");
  });

  it("switches live to Haiku when effort is auto, despite the 1M→200K fallback", () => {
    // The harmless context fallback must NOT force a confirm/restart — this is
    // the on-the-fly switch the user expects to keep working.
    const plan = planModelSwitch(CAPS, HAIKU, "auto", { [CONTEXT_1M_FLAG]: true });
    expect(plan.contextCapped).toBe(true);
    expect(plan.effortReset).toBe(false);
    expect(plan.hasConflict).toBe(false);
    expect(plan.clampedEffort).toBe("auto");
  });

  it("uses the flag default when the 1M key is absent (default on → capped, still live)", () => {
    const plan = planModelSwitch(CAPS, HAIKU, "auto", {});
    expect(plan.contextCapped).toBe(true);
    expect(plan.hasConflict).toBe(false);
  });

  it("no context conflict when 1M was explicitly off", () => {
    const plan = planModelSwitch(CAPS, HAIKU, "auto", { [CONTEXT_1M_FLAG]: false });
    expect(plan.contextCapped).toBe(false);
    expect(plan.hasConflict).toBe(false);
  });
});

describe("modelLabel", () => {
  it("resolves the catalog label", () => {
    expect(modelLabel(CAPS, OPUS)).toBe("Opus 4.8");
  });

  it("falls back to the raw id for unknown models", () => {
    expect(modelLabel(CAPS, "legacy-model")).toBe("legacy-model");
  });
});

describe("describeModelSwitch", () => {
  it("live switch (Sonnet→Opus): no restart, instant cost note, no consequences", () => {
    const plan = planModelSwitch(CAPS, OPUS, "high", { [CONTEXT_1M_FLAG]: true });
    const d = describeModelSwitch(plan, modelLabel(CAPS, OPUS));
    expect(d.needsRestart).toBe(false);
    expect(d.confirmLabel).toBe("Switch");
    expect(d.consequences).toEqual([]);
    // every switch warns about the model-scoped cache miss; the live one is "instant"
    expect(d.costNote).toMatch(/instant/i);
    expect(d.costNote).toMatch(/cache/i);
    expect(d.costNote).toContain("Opus 4.8");
  });

  it("restart switch (Opus xhigh,1M → Haiku): restart label + both consequences + restart-flavored cost note", () => {
    const plan = planModelSwitch(CAPS, HAIKU, "xhigh", { [CONTEXT_1M_FLAG]: true });
    const d = describeModelSwitch(plan, modelLabel(CAPS, HAIKU));
    expect(d.needsRestart).toBe(true);
    expect(d.confirmLabel).toBe("Switch & restart");
    expect(d.consequences).toHaveLength(2);
    expect(d.consequences.some((c) => /effort/i.test(c))).toBe(true);
    expect(d.consequences.some((c) => /200K/i.test(c))).toBe(true);
    expect(d.costNote).toMatch(/restart/i);
    expect(d.costNote).toMatch(/cache/i);
    expect(d.costNote).toContain("Haiku 4.5");
  });

  it("live switch with context cap (Haiku, effort auto, 1M on): no restart but lists the 200K cap", () => {
    const plan = planModelSwitch(CAPS, HAIKU, "auto", { [CONTEXT_1M_FLAG]: true });
    const d = describeModelSwitch(plan, modelLabel(CAPS, HAIKU));
    expect(d.needsRestart).toBe(false);
    expect(d.confirmLabel).toBe("Switch");
    expect(d.consequences).toEqual([
      "Context window falls back to 200K (the new model has no 1M window).",
    ]);
    expect(d.costNote).toMatch(/instant/i);
  });
});
