import { rmSync } from "node:fs";
import { E2E_DATA_DIR } from "./fixtures/paths";

/** Remove the isolated state/fixtures dir after the suite — leave nothing behind. */
export default function globalTeardown(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
}
