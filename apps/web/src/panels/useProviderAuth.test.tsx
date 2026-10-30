import { expect, test } from "bun:test";
import type { ProviderStatusReport } from "@thinkrail/contracts";
import { warnsExtraUsageOnSignIn } from "./useProviderAuth";

function report(anthropicExtraUsage?: boolean): ProviderStatusReport {
	return {
		providers: [],
		jbcentral: { state: "absent" },
		jbcentralInstall: { platform: "linux", shell: "bash", command: "install" },
		...(anthropicExtraUsage === undefined ? {} : { warnings: { anthropicExtraUsage } }),
	};
}

test("the Connect dialog warns only for an Anthropic OAuth sign-in while pi's setting is on", () => {
	const oauth = { providerId: "anthropic", method: "oauth" as const };
	expect(warnsExtraUsageOnSignIn(oauth, report(true))).toBe(true);
	expect(warnsExtraUsageOnSignIn(oauth, report())).toBe(true);
	expect(warnsExtraUsageOnSignIn(oauth, report(false))).toBe(false);
	expect(
		warnsExtraUsageOnSignIn({ providerId: "anthropic", method: "api_key" }, report(true)),
	).toBe(false);
	expect(warnsExtraUsageOnSignIn({ providerId: "anthropic" }, report(true))).toBe(false);
	expect(
		warnsExtraUsageOnSignIn({ providerId: "openai-codex", method: "oauth" }, report(true)),
	).toBe(false);
});
