import { expect, test } from "bun:test";
import type { JbcentralStatus, ProviderStatus, ProviderStatusReport } from "@thinkrail/contracts";
import { reportHasModelSource } from "./useProviderStatus";

const INSTALL = { platform: "mac", shell: "bash", command: "brew install" } as const;

const report = (
	providers: ProviderStatus[],
	jbcentral: JbcentralStatus = { state: "absent" },
): ProviderStatusReport => ({ providers, jbcentral, jbcentralInstall: INSTALL });

const provider = (id: string, configured: boolean): ProviderStatus => ({
	id,
	name: id,
	configured,
});

test("a configured standard provider is a model source", () => {
	expect(reportHasModelSource(report([provider("anthropic", true)]))).toBe(true);
});

test("no configured provider and no Central is not a model source", () => {
	expect(reportHasModelSource(report([provider("anthropic", false)]))).toBe(false);
});

test("a connected JetBrains Central is a model source even with no standard provider (#755)", () => {
	expect(
		reportHasModelSource(
			report([provider("anthropic", false)], {
				state: "configured",
				version: "1.6.2",
				signedOut: false,
				proxyStopped: false,
			}),
		),
	).toBe(true);
});

test("a signed-out or proxy-stopped Central does not count as a model source", () => {
	expect(
		reportHasModelSource(
			report([], { state: "configured", version: "1.6.2", signedOut: true, proxyStopped: false }),
		),
	).toBe(false);
	expect(
		reportHasModelSource(
			report([], { state: "configured", version: "1.6.2", signedOut: false, proxyStopped: true }),
		),
	).toBe(false);
	expect(
		reportHasModelSource(report([], { state: "supported", version: "1.6.2", signedOut: false })),
	).toBe(false);
});
