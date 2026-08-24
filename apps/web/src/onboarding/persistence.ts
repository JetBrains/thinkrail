import { STORAGE_PREFIX } from "../constants/branding";
import { NO_ONBOARDING, type OnboardingState, useAppStore } from "../store";
import { getTransport } from "../transport";

function storageKey(): string {
	return `${STORAGE_PREFIX}onboarding:${getTransport().httpBase()}`;
}

export function readPersistedOnboarding(): OnboardingState {
	try {
		const raw = localStorage.getItem(storageKey());
		if (!raw) return NO_ONBOARDING;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return NO_ONBOARDING;
		const value = parsed as Record<string, unknown>;
		const stage = value.stage;
		return {
			flow: value.flow === "demo" ? "demo" : null,
			stage: stage === "welcome" || stage === "picker" || stage === "live" ? stage : null,
			demoProjectId: typeof value.demoProjectId === "string" ? value.demoProjectId : null,
			dismissed: value.dismissed === true,
		};
	} catch {
		return NO_ONBOARDING;
	}
}

function persistOnboarding(onboarding: OnboardingState): void {
	try {
		localStorage.setItem(storageKey(), JSON.stringify(onboarding));
	} catch {}
}

export function initOnboardingPersistence(): void {
	useAppStore.getState().hydrateOnboarding(readPersistedOnboarding());
	let previous = useAppStore.getState().onboarding;
	useAppStore.subscribe((state) => {
		if (state.onboarding === previous) return;
		previous = state.onboarding;
		persistOnboarding(previous);
	});
}
