import { describe, it, expect } from "vitest";
import { getWizardConfig, isWizardSkill } from "../registry";

describe("Wizard registry", () => {
  describe("isWizardSkill", () => {
    it("recognizes registered wizards", () => {
      expect(isWizardSkill("new-project")).toBe(true);
      expect(isWizardSkill("goal-and-requirements")).toBe(true);
      expect(isWizardSkill("architecture-design")).toBe(true);
    });

    it("returns false for non-wizard skills and falsy input", () => {
      expect(isWizardSkill("ticket-execute")).toBe(false);
      expect(isWizardSkill("some-random-skill")).toBe(false);
      expect(isWizardSkill(null)).toBe(false);
      expect(isWizardSkill(undefined)).toBe(false);
    });
  });

  describe("getWizardConfig — new-project", () => {
    it("returns running stepper while session is active", () => {
      const c = getWizardConfig("new-project", "running");
      expect(c).not.toBeNull();
      expect(c!.artifactPath).toBe("GOAL&REQUIREMENTS.md");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:done",
        "Guided session:active",
        "Goal & Requirements doc:pending",
      ]);
    });

    it("advances main step to active once session is done", () => {
      const c = getWizardConfig("new-project", "done");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:done",
        "Guided session:done",
        "Goal & Requirements doc:active",
      ]);
    });
  });

  describe("getWizardConfig — architecture-design", () => {
    it("inherits prior wizard's steps as done and shows Architecture as active while running", () => {
      const c = getWizardConfig("architecture-design", "running");
      expect(c!.artifactPath).toBe("DESIGN_DOC.md");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:done",
        "Guided session:done",
        "Goal & Requirements doc:done",
        "Architecture:active",
      ]);
    });

    it("keeps Architecture active on the done screen (still the user's location)", () => {
      const c = getWizardConfig("architecture-design", "done");
      const last = c!.steps[c!.steps.length - 1];
      expect(last).toEqual({ label: "Architecture", status: "active" });
    });
  });

  it("returns null for non-wizard skills", () => {
    expect(getWizardConfig("ticket-execute", "running")).toBeNull();
    expect(getWizardConfig(null, undefined)).toBeNull();
  });
});
