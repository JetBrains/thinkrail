import type { Page } from "@playwright/test";
import type { KeybindingOverrides } from "@thinkrail/contracts";
import { E2eWire } from "./wire";

export async function setKeybindings(page: Page, keybindings: KeybindingOverrides): Promise<void> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("settings.update", { config: { keybindings } });
	} finally {
		wire.close();
	}
}

export async function resetKeybindings(page: Page): Promise<void> {
	if (page.isClosed() || !page.url().startsWith("http")) return;
	await setKeybindings(page, {});
}
