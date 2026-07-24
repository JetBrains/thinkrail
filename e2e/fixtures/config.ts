import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DATA_DIR } from "./paths";

/** Both onboarding flags pre-set: the shared suite never meets the blocking first-run overlay. */
export const SEEDED_CONFIG = {
	theme: "dark",
	onboarding: {
		introSeenAt: "2026-01-01T00:00:00.000Z",
		workspaceBannerDismissedAt: "2026-01-01T00:00:00.000Z",
	},
};

/** (Re)write the host's `config.json` — the host reads it per-request, so it applies on next load. */
export function seedConfig(config: object = SEEDED_CONFIG): void {
	writeFileSync(join(E2E_DATA_DIR, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}
