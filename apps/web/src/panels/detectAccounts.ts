import type { DetectedAccount } from "@thinkrail/contracts";
import { selectSupportsOnboarding, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function detectAccounts(): Promise<DetectedAccount[]> {
	if (!selectSupportsOnboarding(useAppStore.getState())) return Promise.resolve([]);
	return getTransport()
		.request("provider.detect", {})
		.then((result) => result.accounts)
		.catch(() => []);
}
