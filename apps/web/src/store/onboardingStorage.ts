/**
 * Persisted "seen" flag for the first-run onboarding overlay. A best-effort localStorage mirror (matches
 * the fail-soft theme-hint pattern): the transient open-state lives in the store, only this durable bit
 * of "the user has seen onboarding" survives reloads. Any storage failure degrades to "not seen".
 */
const ONBOARDING_SEEN_KEY = "thinkrail:onboardingSeen";

/** True once the user has completed (or dismissed) first-run onboarding. Fail-soft → false. */
export function readOnboardingSeen(): boolean {
	try {
		return localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
	} catch {
		return false;
	}
}

/** Record that onboarding has been seen. Best-effort; a storage failure is silently ignored. */
export function markOnboardingSeen(): void {
	try {
		localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
	} catch {
		return;
	}
}
