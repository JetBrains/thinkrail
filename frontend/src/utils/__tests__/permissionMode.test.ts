import { describe, it, expect } from "vitest";
import type { LabeledOption } from "@/types/rpc-methods.ts";
import { permissionModeLabel, permissionModeTooltip } from "@/utils/permissionMode.ts";

const MODES: LabeledOption[] = [
  { value: "default", label: "Ask first", description: "Prompts before edits." },
  { value: "bypassPermissions", label: "Yolo", description: "Runs every tool." },
  { value: "plain", label: "Plain" },
];

describe("permissionModeTooltip", () => {
  it("appends the raw value after the prose", () => {
    expect(permissionModeTooltip(MODES[1])).toBe("Runs every tool.  ·  bypassPermissions");
  });

  it("falls back to the raw value when there is no description", () => {
    expect(permissionModeTooltip(MODES[2])).toBe("plain");
  });
});

describe("permissionModeLabel", () => {
  it("returns the label for a known mode", () => {
    expect(permissionModeLabel(MODES, "bypassPermissions")).toBe("Yolo");
  });

  it("falls back to the raw value for an unknown mode", () => {
    expect(permissionModeLabel(MODES, "dontAsk")).toBe("dontAsk");
  });
});
