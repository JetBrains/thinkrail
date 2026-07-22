/**
 * MOCK first-run flag for the onboarding flow — client-only view state in localStorage (no wire/server).
 * Absent = the project hasn't completed onboarding yet, so the blocking first-run overlay auto-opens.
 * Mirrors the `docHistoryStorage`/`panelLayoutStorage` pattern; fails soft.
 */
const KEY = "thinkrail:onboardingSeen";

export function readOnboardingSeen(): boolean {
	try {
		return localStorage.getItem(KEY) === "true";
	} catch {
		return false;
	}
}

export function markOnboardingSeen(): void {
	try {
		localStorage.setItem(KEY, "true");
	} catch {
		// Storage unavailable — best-effort; a re-launch would just show onboarding again.
	}
}
