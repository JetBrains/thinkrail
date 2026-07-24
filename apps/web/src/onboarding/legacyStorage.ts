/**
 * PR #113 shipped the seen-flag as a per-device localStorage boolean before it moved into the
 * host-synced `AppConfig`. This is the one-time migration shim: read the legacy key, fold it into
 * config (`state.ts`), clear it. Delete this file when the legacy key has been out in the wild long
 * enough to not matter.
 */
const LEGACY_KEY = "thinkrail:onboardingSeen";

/** True when this device carries #113's pre-config seen flag. Fail-soft → false. */
export function readLegacySeen(): boolean {
	try {
		return localStorage.getItem(LEGACY_KEY) === "true";
	} catch {
		return false;
	}
}

/** Remove the legacy flag once folded into config. Best-effort. */
export function clearLegacySeen(): void {
	try {
		localStorage.removeItem(LEGACY_KEY);
	} catch {
		// fail-soft: worst case the fold repeats, which is idempotent
	}
}
