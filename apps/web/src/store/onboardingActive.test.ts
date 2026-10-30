import { expect, test } from "bun:test";
import { ONBOARDING_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { OnboardingWizardGate } from "./appStore";
import { selectOnboardingActive, selectOnboardingEligible } from "./selectors";

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
	expect(
		selectOnboardingActive({ ...coldStart, onboardingWizard: "shown", onboardingDismissed: true }),
	).toBe(true);
});

test("first-run prompts are free once the wizard is decided against, done, or impossible", () => {
	expect(selectOnboardingActive({ ...coldStart, onboardingWizard: "hidden" })).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, onboardingWizard: "shown", projects: [{}] })).toBe(
		false,
	);
	expect(selectOnboardingActive({ ...coldStart, onboardingDismissed: true })).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, recentProjects: [{}] })).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, projects: [{}] })).toBe(false);
	expect(
		selectOnboardingActive({ ...coldStart, protocolVersion: ONBOARDING_PROTOCOL_VERSION - 1 }),
	).toBe(false);
	expect(selectOnboardingActive({ ...coldStart, protocolVersion: null })).toBe(false);
});

test("the built-in Chats container, present from boot, is no project: the wizard stays eligible and active", () => {
	const withContainer = { ...coldStart, projects: [{ kind: "chats" as const }] };
	expect(selectOnboardingEligible(withContainer)).toBe(true);
	expect(selectOnboardingActive(withContainer)).toBe(true);
	expect(selectOnboardingActive({ ...withContainer, onboardingWizard: "shown" })).toBe(true);
	expect(
		selectOnboardingActive({ ...withContainer, projects: [{ kind: "chats" as const }, {}] }),
	).toBe(false);
});
