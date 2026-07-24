import type { OnboardingConfig } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Merge one onboarding flag into the host config. `settings.update` merges SHALLOWLY server-side, so
 * the whole composed `onboarding` object is sent — never a lone field, or the sibling flag would be
 * dropped. Two writers call this (`markIntroSeen`, `markBannerDismissed`); two near-simultaneous calls
 * (e.g. finishing first-run immediately followed by dismissing the banner) would otherwise each read
 * `appConfig.onboarding` before either write's round-trip lands, so the later write's compose could drop
 * the earlier one's flag. Writes are therefore serialized through a module-level chain — each write's
 * read happens only after the previous write's response is folded in — and the response is applied via
 * `applyConfig` immediately rather than waiting on the `settings.changed` broadcast, so a chained write's
 * read can never see a pre-write snapshot. Fail-soft: an offline write means a re-nag next launch, never
 * a broken UI.
 */
let writeChain: Promise<void> = Promise.resolve();

function writeOnboarding(patch: Partial<OnboardingConfig>): void {
	writeChain = writeChain
		.then(async () => {
			const current = useAppStore.getState().appConfig?.onboarding;
			const config = { onboarding: { ...current, ...patch } };
			const next = await getTransport().request("settings.update", { config });
			// Fold the authoritative result in immediately — don't wait for the settings.changed broadcast,
			// so a chained write that reads store state cannot see a pre-write snapshot.
			useAppStore.getState().applyConfig(next);
		})
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
