import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { ProviderStatusReport } from "@thinkrail/contracts";
import { useAppStore } from "@/store";
import * as wireTransport from "../transport/wireTransport";
import { cancelUnownedLogin, startReservedLogin, warnsExtraUsageOnSignIn } from "./useProviderAuth";

const requests: [string, unknown][] = [];
let resolveStart: (value: { loginId: string }) => void = () => {};
let restore: () => void = () => {};

beforeEach(() => {
	requests.length = 0;
	useAppStore.setState({ activeLogin: null, loginStarting: false, unheldLoginFrame: null });
	const transport = {
		request: (method: string, params: unknown) => {
			requests.push([method, params]);
			if (method === "provider.loginStart") {
				return new Promise<{ loginId: string }>((resolve) => {
					resolveStart = resolve;
				});
			}
			return Promise.resolve({ ok: true });
		},
	} as unknown as ReturnType<typeof wireTransport.getTransport>;
	const spy = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
	restore = () => spy.mockRestore();
});

afterEach(() => {
	restore();
	useAppStore.setState({ activeLogin: null, loginStarting: false, unheldLoginFrame: null });
});

test("a login whose surface closed before its id arrived is cancelled, never left hidden", async () => {
	expect(useAppStore.getState().reserveLogin()).toBe(true);
	const started = startReservedLogin("anthropic", "oauth");
	useAppStore.getState().applyLoginFrame({
		loginId: "login_7",
		providerId: "anthropic",
		frame: { kind: "authUrl", url: "https://example.test/sign-in" },
	});
	cancelUnownedLogin();
	useAppStore.getState().applyLoginFrame({
		loginId: "login_7",
		providerId: "anthropic",
		frame: { kind: "progress", message: "Waiting" },
	});
	resolveStart({ loginId: "login_7" });
	await started;

	expect(useAppStore.getState().activeLogin).toBeNull();
	expect(useAppStore.getState().loginStarting).toBe(false);
	expect(requests.filter(([m]) => m === "provider.loginCancel").at(-1)).toEqual([
		"provider.loginCancel",
		{ loginId: "login_7" },
	]);
});

test("a login whose surface stays open opens its dialog", async () => {
	useAppStore.getState().reserveLogin();
	const started = startReservedLogin("anthropic", "oauth");
	resolveStart({ loginId: "login_8" });
	await started;
	expect(useAppStore.getState().activeLogin).toMatchObject({
		loginId: "login_8",
		status: "active",
	});
	expect(requests.map(([m]) => m)).toEqual(["provider.loginStart"]);
});

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
