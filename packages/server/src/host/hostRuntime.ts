import { setDisabledPackagesResolver } from "../agent";
import { initializeJbcentralRuntime } from "../auth";
import { getConfig } from "../settings";

export async function initializeHostRuntime(): Promise<void> {
	setDisabledPackagesResolver(() => new Set(getConfig().disabledPackages));
	await initializeJbcentralRuntime();
}
