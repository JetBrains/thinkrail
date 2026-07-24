import type { OnboardingConfig } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Merge one onboarding flag into the host config. `settings.update` merges SHALLOWLY server-side, so
 * the whole composed `onboarding` object is sent — never a lone field, or the sibling flag would be
 * dropped. Convergence arrives on the `settings.changed` broadcast → `applyConfig`. Fail-soft: an
 * offline write means a re-nag next launch, never a broken UI.
 */
function writeOnboarding(patch: Partial<OnboardingConfig>): void {
	const current = useAppStore.getState().appConfig?.onboarding;
	getTransport()
		.request("settings.update", { config: { onboarding: { ...current, ...patch } } })
		.catch(() => {});
}

/** Record that the intro overlay was completed or skipped (never auto-shown again, on any client). */
export function markIntroSeen(): void {
	writeOnboarding({ introSeenAt: new Date().toISOString() });
}

/** Record that the first-worktree path banner was dismissed (cross-client). */
export function markBannerDismissed(): void {
	writeOnboarding({ workspaceBannerDismissedAt: new Date().toISOString() });
}
