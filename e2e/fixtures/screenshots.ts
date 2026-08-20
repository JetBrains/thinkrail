import { join } from "node:path";
import { E2E_SCREENSHOT_DIR } from "./paths";

/** Page and Locator both satisfy this; typing the target structurally avoids narrowing a union per call. */
interface Screenshotable {
	screenshot(options: { path: string }): Promise<Buffer>;
}

/**
 * Capture one review PNG as `<E2E_SCREENSHOT_DIR>/<group>/<name>.png` (Playwright creates the directories).
 * Element shots are preferred over page shots: a card framed on its own stays legible in a summary, and it
 * does not change every time unrelated chrome moves.
 */
export async function shot(target: Screenshotable, group: string, name: string): Promise<void> {
	await target.screenshot({ path: join(E2E_SCREENSHOT_DIR, group, `${name}.png`) });
}
