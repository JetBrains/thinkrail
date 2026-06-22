import { mkdirSync, rmSync } from "node:fs";
import { E2E_DATA_DIR } from "./fixtures/paths";

/** Create a clean, isolated state/fixtures dir before the suite. (M4+ seeds sample git repos here.) */
export default function globalSetup(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_DATA_DIR, { recursive: true });
}
