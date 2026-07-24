import { rmSync } from "node:fs";
import { E2E_BINARY_CACHE, E2E_DATA_DIR } from "./fixtures/paths";

/** Remove the isolated state/fixtures dirs after the suite — leave nothing behind. (The binary cache
 * only exists after an `e2e:binary` run; wiping it here is what keeps that suite's staging fresh.) */
export default function globalTeardown(): void {
	// Playwright tears the webServer down alongside global teardown; retry ENOTEMPTY if the host finishes a
	// final isolated-state write while `rmSync` is walking the tree.
	rmSync(E2E_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	rmSync(E2E_BINARY_CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
