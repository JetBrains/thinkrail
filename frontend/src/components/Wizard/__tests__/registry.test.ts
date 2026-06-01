import { describe, it, expect } from "vitest";
import {
  chainsForSkill,
  entryTransition,
  getWizardConfig,
  isWizardSkill,
  outcomeTransitions,
  resolveFollowupChain,
  stepperFromJourney,
  type JourneyEntry,
} from "../registry";

describe("Wizard registry", () => {
  describe("isWizardSkill", () => {
    it("recognizes registered wizards", () => {
      expect(isWizardSkill("new-project")).toBe(true);
      expect(isWizardSkill("goal-and-requirements")).toBe(true);
      expect(isWizardSkill("architecture-design")).toBe(true);
      expect(isWizardSkill("investigate-project")).toBe(true);
    });

    it("returns false for non-wizard skills and falsy input", () => {
      expect(isWizardSkill("ticket-execute")).toBe(false);
      expect(isWizardSkill("some-random-skill")).toBe(false);
      expect(isWizardSkill(null)).toBe(false);
      expect(isWizardSkill(undefined)).toBe(false);
    });
  });

  // The stepper reveals steps progressively. While the new-project
  // session runs, only its three cells show — Describe (pre-chat),
  // Guided session (running), Goal & Requirements doc (outcome).
  // Architecture's cells appear only once it's started.
  describe("getWizardConfig — new-project chain", () => {
    it("pre-chat makes Describe active (Architecture not yet revealed)", () => {
      const c = getWizardConfig("new-project", "pre-chat");
      expect(c).not.toBeNull();
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:active",
        "Guided session:pending",
        "Goal & Requirements doc:pending",
      ]);
    });

    it("running advances Describe → done, Guided session → active", () => {
      const c = getWizardConfig("new-project", "running");
      expect(c!.artifactPath).toBe("GOAL&REQUIREMENTS.md");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:done",
        "Guided session:active",
        "Goal & Requirements doc:pending",
      ]);
    });

    it("done-screen makes the G&R outcome cell active", () => {
      const c = getWizardConfig("new-project", "done-screen");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:done",
        "Guided session:done",
        "Goal & Requirements doc:active",
      ]);
    });

    it("architecture-design running reveals + activates Architecture", () => {
      const c = getWizardConfig("architecture-design", "running");
      expect(c!.artifactPath).toBe("DESIGN_DOC.md");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "Describe:done",
        "Guided session:done",
        "Goal & Requirements doc:done",
        "Architecture:active",
        "Design doc:pending",
      ]);
    });

    it("architecture-design done-screen makes the final outcome cell active", () => {
      const c = getWizardConfig("architecture-design", "done-screen");
      const last = c!.steps[c!.steps.length - 1];
      expect(last).toEqual({ label: "Design doc", status: "active" });
    });
  });

  // Progressive reveal: while investigating, only 3 cells show —
  // What we'll read (pre-chat), Investigation (running), Review
  // (outcome). Clarify + Verify & save appear only after the user
  // clicks "Continue → Clarify" and that session starts.
  describe("getWizardConfig — investigate-project chain", () => {
    it("pre-chat makes 'What we'll read' active (Clarify not revealed yet)", () => {
      const c = getWizardConfig(
        "investigate-project",
        "pre-chat",
        "investigate-project",
      );
      expect(c!.artifactPath).toBe("DESIGN_DOC.md");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "What we'll read:active",
        "Investigation:pending",
        "Review:pending",
      ]);
    });

    it("running advances 'What we'll read' → done, 'Investigation' → active", () => {
      const c = getWizardConfig(
        "investigate-project",
        "running",
        "investigate-project",
      );
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "What we'll read:done",
        "Investigation:active",
        "Review:pending",
      ]);
    });

    it("investigate done-screen makes its own 'Review' outcome cell active", () => {
      const c = getWizardConfig(
        "investigate-project",
        "done-screen",
        "investigate-project",
      );
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "What we'll read:done",
        "Investigation:done",
        "Review:active",
      ]);
    });

    it("Clarify (new-project) running advances Clarify to active", () => {
      const c = getWizardConfig("new-project", "running", "investigate-project");
      expect(c!.artifactPath).toBe("GOAL&REQUIREMENTS.md");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "What we'll read:done",
        "Investigation:done",
        "Review:done",
        "Clarify:active",
        "Verify & save:pending",
      ]);
    });

    it("Clarify done-screen makes 'Verify & save' active (final outcome)", () => {
      const c = getWizardConfig("new-project", "done-screen", "investigate-project");
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "What we'll read:done",
        "Investigation:done",
        "Review:done",
        "Clarify:done",
        "Verify & save:active",
      ]);
    });

    it("alias goal-and-requirements resolves to the investigate-chain step when hinted", () => {
      const c = getWizardConfig(
        "goal-and-requirements",
        "running",
        "investigate-project",
      );
      expect(c!.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
        "What we'll read:done",
        "Investigation:done",
        "Review:done",
        "Clarify:active",
        "Verify & save:pending",
      ]);
    });

    it("architecture-design stays on the new-project chain only", () => {
      const c = getWizardConfig("architecture-design", "running");
      expect(c!.steps.some((s) => s.label === "Investigation")).toBe(false);
      expect(c!.steps.some((s) => s.label === "Architecture")).toBe(true);
    });
  });

  describe("transitions (prompts live on edges)", () => {
    it("new-project entry builds a prompt from the idea text", () => {
      const t = entryTransition("new-project");
      expect(t).not.toBeNull();
      expect(t!.target).toBe("new-project");
      const prompt = t!.buildPrompt!({ projectName: "shop", ideaText: "sell socks" });
      expect(prompt).toContain("Project name: shop");
      expect(prompt).toContain("sell socks");
    });

    it("investigate entry builds a prompt from selected paths", () => {
      const t = entryTransition("investigate-project");
      const prompt = t!.buildPrompt!({
        projectName: "api",
        selectedPaths: ["README.md", "src/"],
      });
      expect(prompt).toContain("Project: api");
      expect(prompt).toContain("- README.md");
      expect(prompt).toContain("- src/");
    });

    it("investigate outcome offers a Clarify CTA targeting new-project", () => {
      const actions = outcomeTransitions("investigate-project", "investigate-project");
      expect(actions.map((a) => a.target)).toContain("new-project");
      expect(actions.some((a) => a.primary)).toBe(true);
    });

    it("returns no outcome transitions for terminal / unknown steps", () => {
      expect(outcomeTransitions("architecture-design")).toEqual([]);
      expect(outcomeTransitions("ticket-execute")).toEqual([]);
      expect(outcomeTransitions(null)).toEqual([]);
    });
  });

  describe("chainsForSkill", () => {
    it("returns all chains a skill participates in", () => {
      expect(chainsForSkill("architecture-design").sort()).toEqual([
        "new-project",
      ]);
      expect(chainsForSkill("investigate-project").sort()).toEqual([
        "investigate-project",
      ]);
      expect(chainsForSkill("new-project").sort()).toEqual([
        "investigate-project",
        "new-project",
      ]);
      expect(chainsForSkill("goal-and-requirements").sort()).toEqual([
        "investigate-project",
        "new-project",
      ]);
    });

    it("returns empty for unknown skills", () => {
      expect(chainsForSkill("ticket-execute")).toEqual([]);
    });
  });

  it("returns null for non-wizard skills", () => {
    expect(getWizardConfig("ticket-execute", "running")).toBeNull();
    expect(getWizardConfig(null, "pre-chat")).toBeNull();
  });
});

// The cumulative stepper is built from the user's actual session
// journey, so it grows across chain boundaries instead of resetting.
// Each session contributes a running + outcome cell (and a pre-chat
// cell for entry steps with a custom window).
describe("stepperFromJourney — cumulative cross-chain stepper", () => {
  const INVESTIGATE: JourneyEntry = {
    bonsaiSid: "s1",
    skillId: "investigate-project",
    chainId: "investigate-project",
  };
  const CLARIFY: JourneyEntry = {
    bonsaiSid: "s2",
    skillId: "new-project",
    chainId: "investigate-project",
  };
  const ARCHITECTURE: JourneyEntry = {
    bonsaiSid: "s3",
    skillId: "architecture-design",
    chainId: "new-project",
  };

  const labels = (j: JourneyEntry[], active: string, phase: Parameters<typeof stepperFromJourney>[2]) =>
    stepperFromJourney(j, active, phase)!.steps.map((s) => `${s.label}:${s.status}`);

  it("returns null for an empty journey (caller falls back to chain config)", () => {
    expect(stepperFromJourney([], "s1", "running")).toBeNull();
  });

  it("entry session shows its 3 cells, running cell active", () => {
    expect(labels([INVESTIGATE], "s1", "running")).toEqual([
      "What we'll read:done",
      "Investigation:active",
      "Review:pending",
    ]);
  });

  it("Clarify done-screen keeps the investigate steps (not overwritten by greenfield labels)", () => {
    // This is the regression: a `new-project` session in the investigate
    // chain must NOT relabel the path to Describe/Guided session/G&R.
    expect(labels([INVESTIGATE, CLARIFY], "s2", "done-screen")).toEqual([
      "What we'll read:done",
      "Investigation:done",
      "Review:done",
      "Clarify:done",
      "Verify & save:active",
    ]);
  });

  it("Architecture appends two cells across the chain boundary, prior steps stay done", () => {
    expect(labels([INVESTIGATE, CLARIFY, ARCHITECTURE], "s3", "running")).toEqual([
      "What we'll read:done",
      "Investigation:done",
      "Review:done",
      "Clarify:done",
      "Verify & save:done",
      "Architecture:active",
      "Design doc:pending",
    ]);
  });

  it("artifactPath tracks the active session's step", () => {
    const c = stepperFromJourney([INVESTIGATE, CLARIFY, ARCHITECTURE], "s3", "running")!;
    expect(c.artifactPath).toBe("DESIGN_DOC.md");
    const g = stepperFromJourney([INVESTIGATE, CLARIFY], "s2", "done-screen")!;
    expect(g.artifactPath).toBe("GOAL&REQUIREMENTS.md");
  });

  it("falls back to the last entry when the active sid isn't in the journey", () => {
    expect(labels([INVESTIGATE, CLARIFY], "unknown", "done-screen")).toEqual([
      "What we'll read:done",
      "Investigation:done",
      "Review:done",
      "Clarify:done",
      "Verify & save:active",
    ]);
  });
});

describe("resolveFollowupChain", () => {
  it("keeps the current chain when the target lives in it (Clarify stays in investigate)", () => {
    expect(resolveFollowupChain("investigate-project", "new-project")).toBe(
      "investigate-project",
    );
  });

  it("crosses into the target's own chain when it doesn't (Clarify → Architecture)", () => {
    expect(resolveFollowupChain("investigate-project", "architecture-design")).toBe(
      "new-project",
    );
  });

  it("falls back to the target's first chain when there's no current chain", () => {
    expect(resolveFollowupChain(null, "new-project")).toBe("new-project");
  });

  it("returns null for an unknown target skill", () => {
    expect(resolveFollowupChain("new-project", "ticket-execute")).toBeNull();
  });
});
