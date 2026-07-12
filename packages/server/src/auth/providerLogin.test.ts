import { afterEach, describe, expect, test } from "bun:test";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { LoginPush } from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import {
	cancelAllLogins,
	cancelLogin,
	logoutProvider,
	resolveLogin,
	setLoginPublisher,
	setProviderApiKey,
	startLogin,
} from "./providerLogin";

/** Let queued microtasks/timers run so a detached `login()` continuation settles before we assert. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

type LoginImpl = (providerId: string, callbacks: OAuthLoginCallbacks) => Promise<void>;

interface Harness {
	frames: LoginPush[];
	refreshCount: () => number;
	setCalls: () => [string, unknown][];
	logoutCalls: () => string[];
	lastSignal: () => AbortSignal | undefined;
}

/** Install a fake pi runtime whose `authStorage.login` is `loginImpl`, and capture pushed frames + calls. */
function install(loginImpl: LoginImpl): Harness {
	const frames: LoginPush[] = [];
	setLoginPublisher((push) => frames.push(push));

	let refresh = 0;
	const set: [string, unknown][] = [];
	const logout: string[] = [];
	let signal: AbortSignal | undefined;

	const authStorage = {
		login: (providerId: string, callbacks: OAuthLoginCallbacks) => {
			signal = callbacks.signal;
			return loginImpl(providerId, callbacks);
		},
		set: (id: string, cred: unknown) => set.push([id, cred]),
		logout: (id: string) => logout.push(id),
	} as unknown as AuthStorage;
	const modelRegistry = {
		refresh: () => {
			refresh++;
		},
	} as unknown as ModelRegistry;

	configurePiRuntime({ authStorage, modelRegistry });
	return {
		frames,
		refreshCount: () => refresh,
		setCalls: () => set,
		logoutCalls: () => logout,
		lastSignal: () => signal,
	};
}

afterEach(() => {
	cancelAllLogins();
	setLoginPublisher(() => {});
	configurePiRuntime(
		undefined as unknown as { authStorage: AuthStorage; modelRegistry: ModelRegistry },
	);
});

describe("startLogin", () => {
	test("returns a handle synchronously (the flow runs detached, never awaited)", () => {
		// A login() that never settles must not block startLogin from returning its loginId.
		const { frames } = install(() => new Promise<void>(() => {}));
		const { loginId } = startLogin("anthropic");
		expect(loginId).toMatch(/^login_\d+$/);
		expect(frames).toEqual([]); // nothing pushed yet — the flow hasn't produced a frame
	});

	test("device-code flow: pushes deviceCode, refreshes the registry, then success", async () => {
		const h = install(async (_id, cb) => {
			cb.onDeviceCode({ userCode: "WDJB-MJHT", verificationUri: "https://x/device" });
		});
		const { loginId } = startLogin("github-copilot");
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["deviceCode", "success"]);
		expect(h.frames[0]).toEqual({
			loginId,
			providerId: "github-copilot",
			frame: {
				kind: "deviceCode",
				userCode: "WDJB-MJHT",
				verificationUri: "https://x/device",
			},
		});
		expect(h.refreshCount()).toBe(1); // refresh happens before the success frame
	});

	test("progress frames stream through, then the terminal success frame", async () => {
		const h = install(async (_id, cb) => {
			cb.onProgress?.("Polling device…");
			cb.onDeviceCode({ userCode: "WDJB-MJHT", verificationUri: "https://x/device" });
			cb.onProgress?.("Authorizing…");
		});
		startLogin("github-copilot");
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual([
			"progress",
			"deviceCode",
			"progress",
			"success",
		]);
		expect(h.frames[0]?.frame).toEqual({ kind: "progress", message: "Polling device…" });
	});

	test("select round-trip: a parked frame is answered by loginReply, then the flow completes", async () => {
		let chosen: string | undefined;
		const h = install(async (_id, cb) => {
			chosen = await cb.onSelect({
				message: "How do you want to sign in?",
				options: [
					{ id: "max", label: "Claude Pro/Max" },
					{ id: "api", label: "API console" },
				],
			});
		});
		const { loginId } = startLogin("anthropic");
		await tick();
		expect(h.frames.at(-1)?.frame).toEqual({
			kind: "select",
			message: "How do you want to sign in?",
			options: [
				{ id: "max", label: "Claude Pro/Max" },
				{ id: "api", label: "API console" },
			],
		});
		resolveLogin({ loginId, value: "max" });
		await tick();
		expect(chosen).toBe("max");
		expect(h.frames.at(-1)?.frame.kind).toBe("success");
	});

	test("authUrl + concurrent paste: onAuth shows the URL while onManualCodeInput awaits a paste", async () => {
		let pasted: string | undefined;
		const h = install(async (_id, cb) => {
			cb.onAuth({ url: "https://provider/authorize?x=1" });
			// The browser-vs-paste race: in this test the paste wins.
			pasted = await cb.onManualCodeInput?.();
		});
		const { loginId } = startLogin("openai-codex");
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["authUrl", "prompt"]);
		expect(h.frames[0]?.frame).toMatchObject({
			kind: "authUrl",
			url: "https://provider/authorize?x=1",
		});
		resolveLogin({ loginId, value: "the-code" });
		await tick();
		expect(pasted).toBe("the-code");
		expect(h.frames.at(-1)?.frame.kind).toBe("success");
	});

	test("error path: a rejected login() pushes an error frame with the message", async () => {
		const h = install(async () => {
			throw new Error("provider said no");
		});
		startLogin("anthropic");
		await tick();
		expect(h.frames).toEqual([
			{
				loginId: expect.any(String),
				providerId: "anthropic",
				frame: { kind: "error", message: "provider said no" },
			},
		]);
		expect(h.refreshCount()).toBe(0); // no refresh on failure
	});
});

describe("cancelLogin", () => {
	test("aborts the signal AND rejects the parked prompt — and pushes no stray terminal frame", async () => {
		const h = install(async (_id, cb) => {
			// Parks forever unless the parked prompt is settled by cancel (which makes onPrompt throw).
			await cb.onPrompt({ message: "Paste code" });
		});
		const { loginId } = startLogin("anthropic");
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt"]);

		cancelLogin(loginId);
		await tick();
		// The login() rejection from the thrown "Login cancelled" must NOT surface as an error frame —
		// cancel already terminated the login, so terminate() returns undefined on the catch.
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt"]);
		expect(h.lastSignal()?.aborted).toBe(true);
	});

	test("a callback firing after cancel pushes no stray frame (push guards on settled)", async () => {
		let captured: OAuthLoginCallbacks | undefined;
		const h = install(async (_id, cb) => {
			captured = cb;
			await cb.onPrompt({ message: "code" });
		});
		const { loginId } = startLogin("anthropic");
		await tick();
		cancelLogin(loginId);
		await tick();
		// pi's detached flow may invoke a callback after we've cancelled — the guard must swallow it.
		captured?.onProgress?.("late progress");
		captured?.onAuth({ url: "https://late" });
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt"]);
	});

	test("a reply after cancel is a no-op (the login is gone)", async () => {
		const h = install(async (_id, cb) => {
			await cb.onPrompt({ message: "code" });
		});
		const { loginId } = startLogin("anthropic");
		await tick();
		cancelLogin(loginId);
		resolveLogin({ loginId, value: "late" }); // must not throw / must not resurrect
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt"]);
	});

	test("cancelAllLogins settles every in-flight login", async () => {
		const signals: (AbortSignal | undefined)[] = [];
		install(async (_id, cb) => {
			signals.push(cb.signal);
			await cb.onPrompt({ message: "code" });
		});
		startLogin("anthropic");
		startLogin("openai-codex");
		await tick();
		cancelAllLogins();
		await tick();
		expect(signals).toHaveLength(2);
		expect(signals.every((s) => s?.aborted)).toBe(true);
	});
});

describe("setProviderApiKey / logoutProvider", () => {
	test("setProviderApiKey stores an api_key credential and refreshes the registry", () => {
		const h = install(async () => {});
		setProviderApiKey("openai", "  sk-abc  ");
		expect(h.setCalls()).toEqual([["openai", { type: "api_key", key: "sk-abc" }]]);
		expect(h.refreshCount()).toBe(1);
	});

	test("setProviderApiKey rejects an empty/blank key", () => {
		install(async () => {});
		expect(() => setProviderApiKey("openai", "   ")).toThrow(/must not be empty/);
	});

	test("logoutProvider removes the credential and refreshes the registry", () => {
		const h = install(async () => {});
		logoutProvider("anthropic");
		expect(h.logoutCalls()).toEqual(["anthropic"]);
		expect(h.refreshCount()).toBe(1);
	});
});
