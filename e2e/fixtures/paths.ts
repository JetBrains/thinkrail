import { tmpdir } from "node:os";
import { join } from "node:path";

/** Isolated on-disk state for an e2e run — so tests never touch the user's real ~/.thinkrail-pi. */
export const E2E_DATA_DIR = join(tmpdir(), "thinkrail-pi-e2e");
