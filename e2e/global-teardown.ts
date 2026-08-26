import { rmSync } from "node:fs";
import { E2E_BINARY_CACHE, E2E_DATA_DIR, E2E_DESKTOP_CACHE } from "./fixtures/paths";

export default function globalTeardown(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	rmSync(E2E_BINARY_CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	rmSync(E2E_DESKTOP_CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
