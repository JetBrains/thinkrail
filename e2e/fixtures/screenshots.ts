import { join } from "node:path";
import { E2E_SCREENSHOT_DIR } from "./paths";

interface Screenshotable {
	screenshot(options: { path: string }): Promise<Buffer>;
}

export async function shot(target: Screenshotable, group: string, name: string): Promise<void> {
	await target.screenshot({ path: join(E2E_SCREENSHOT_DIR, group, `${name}.png`) });
}
