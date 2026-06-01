/**
 * Structural + behavioral invariants on the wizard flow.
 *
 * These guard against silent breakage: a step that can't be reached, an
 * outcome CTA pointing at a non-existent step, or a (step, phase) screen
 * with no — or more than one — active stepper cell (which is exactly the
 * "stepper drifted from the screen" bug class).
 */
import { describe, it, expect } from "vitest";
import {
  __WIZARD_FLOW_FOR_TESTS as WIZARD_FLOW,
  getWizardConfig,
  entryTransition,
  type WizardUiPhase,
} from "../registry";
import { knownChainIds } from "../chains";

describe("WIZARD_FLOW structural invariants", () => {
  it("is non-empty", () => {
    expect(WIZARD_FLOW.length).toBeGreaterThan(0);
  });

  for (const step of WIZARD_FLOW) {
    describe(`step: ${step.id} [chains: ${step.chains.join(",")}]`, () => {
      it("declares a running and an outcome label", () => {
        expect(step.runningLabel.length).toBeGreaterThan(0);
        expect(step.outcomeLabel.length).toBeGreaterThan(0);
      });

      it("declares at least one chain", () => {
        expect(step.chains.length).toBeGreaterThan(0);
      });

      it("outcome CTAs target steps that exist in the flow", () => {
        // Targets may be cross-chain (e.g. investigate Clarify →
        // Architecture, a new-project-chain step). Starting such a
        // transition resets the chain hint — see WizardDonePanel.
        for (const target of step.outcomeTargets) {
          const exists = WIZARD_FLOW.some(
            (s) => s.id === target || (s.aliases ?? []).includes(target),
          );
          expect(
            exists,
            `${step.id} outcome targets "${target}" which is not a registered step`,
          ).toBe(true);
        }
      });
    });
  }
});

describe("Chain coverage invariants", () => {
  for (const chainId of knownChainIds()) {
    describe(`chain: ${chainId}`, () => {
      it("has at least one step", () => {
        expect(WIZARD_FLOW.filter((s) => s.chains.includes(chainId)).length)
          .toBeGreaterThan(0);
      });

      it("first step has a pre-chat page + an entry transition", () => {
        const first = WIZARD_FLOW.find((s) => s.chains.includes(chainId));
        expect(first).toBeDefined();
        expect(
          first!.hasPreChat,
          `Chain ${chainId} first step "${first!.id}" has no pre-chat page`,
        ).toBe(true);
        expect(
          entryTransition(chainId),
          `Chain ${chainId} has no entry transition`,
        ).not.toBeNull();
      });

      it("transition graph reaches every step (no orphans)", () => {
        // Mirror the production walk (registry.ts `reachedSteps`): start
        // at the entry step and follow each step's in-chain outcome edge.
        // Every step in the chain must be reachable this way, or the
        // progressive stepper would never reveal it.
        const entries = WIZARD_FLOW.filter((s) => s.chains.includes(chainId));
        const reached = new Set<string>();
        let node = entries[0];
        while (node && !reached.has(node.id)) {
          reached.add(node.id);
          const next = node.outcomeTargets
            .map((t) =>
              entries.find((e) => e.id === t || (e.aliases ?? []).includes(t)),
            )
            .find((e): e is (typeof entries)[number] => e != null);
          if (!next) break;
          node = next;
        }
        for (const e of entries) {
          expect(
            reached.has(e.id),
            `Chain ${chainId}: step "${e.id}" is not reachable from the entry via transitions`,
          ).toBe(true);
        }
      });
    });
  }
});

/**
 * Behavioral coupling guarantee: for EVERY reachable screen
 * (chain × step × phase) the stepper has exactly one `active` cell.
 * This is the property that makes "stepper drifted from screen"
 * impossible — it is enforced, not just hoped for.
 */
describe("Stepper resolves exactly one active cell (no drift)", () => {
  for (const chainId of knownChainIds()) {
    const steps = WIZARD_FLOW.filter((s) => s.chains.includes(chainId));
    steps.forEach((step, idx) => {
      // Phases a step can actually be rendered in: `running` and
      // `done-screen` always; `pre-chat` only when it has an entry page
      // (the chain's first step).
      const phases: WizardUiPhase[] = step.hasPreChat
        ? ["pre-chat", "running", "done-screen"]
        : ["running", "done-screen"];
      // pre-chat is only reachable on the very first step of a chain.
      const reachable = idx === 0 ? phases : phases.filter((p) => p !== "pre-chat");
      for (const phase of reachable) {
        it(`chain ${chainId} · ${step.id} · ${phase} → one active cell`, () => {
          const c = getWizardConfig(step.id, phase, chainId);
          expect(c, `no config for ${step.id}/${phase}`).not.toBeNull();
          const active = c!.steps.filter((s) => s.status === "active");
          expect(
            active.length,
            `expected one active cell, got [${active.map((s) => s.label).join(", ")}]`,
          ).toBe(1);
        });
      }
    });
  }
});
