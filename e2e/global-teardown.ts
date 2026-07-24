import { rmSync } from "node:fs";
import { E2E_DATA_DIR } from "./fixtures/paths";

/** Remove the isolated state/fixtures dir after the suite — leave nothing behind. */
export default function globalTeardown(): void {
	// Playwright tears the webServer down alongside global teardown; retry ENOTEMPTY if the host finishes a
	// final isolated-state write while `rmSync` is walking the tree.
	rmSync(E2E_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
