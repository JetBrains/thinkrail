import { expect, test } from "bun:test";
import { ONBOARDING_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { OnboardingWizardGate } from "./appStore";
import { selectOnboardingActive } from "./selectors";

const coldStart = {
	protocolVersion: ONBOARDING_PROTOCOL_VERSION,
	onboardingWizard: "pending" as OnboardingWizardGate,
	onboardingDismissed: false,
	projects: [],
	recentProjects: [],
};

test("first-run prompts wait while the wizard is undecided on a cold start, or showing", () => {
	expect(selectOnboardingActive(coldStart)).toBe(true);
	expect(selectOnboardingActive({ ...coldStart, onboardingWizard: "shown" })).toBe(true);
	expect(selectOnboardingActive({ ...coldStart, onboardingWizard: "shown", projects: [{}] })).toBe(
		true,
	);
});

test("first-run prompts are free once the wizard is decided against, done, or impossible", () => {
	expect(selectOnboardingActive({ ...coldStart, onboardingWizard: "hidden" })).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, onboardingDismissed: true })).toBe(false);
	expect(
		selectOnboardingActive({
			...coldStart,
			onboardingWizard: "shown",
			onboardingDismissed: true,
		}),
	).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, recentProjects: [{}] })).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, projects: [{}] })).toBe(false);
	expect(
		selectOnboardingActive({ ...coldStart, protocolVersion: ONBOARDING_PROTOCOL_VERSION - 1 }),
	).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, protocolVersion: null })).toBe(false);
});
