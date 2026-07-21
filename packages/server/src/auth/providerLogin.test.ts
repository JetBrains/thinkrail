import { afterEach, describe, expect, test } from "bun:test";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
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

type LoginImpl = (providerId: string, interaction: AuthInteraction) => Promise<unknown>;

interface Harness {
	frames: LoginPush[];
	/** Every `runtime.login` call as `[providerId, type]`. */
	loginCalls: () => [string, AuthType][];
	logoutCalls: () => string[];
	lastSignal: () => AbortSignal | undefined;
	lastInteraction: () => AuthInteraction | undefined;
}

/** Install a fake pi runtime whose `login` is `loginImpl`, and capture pushed frames + calls. */
function install(loginImpl: LoginImpl): Harness {
	const frames: LoginPush[] = [];
	setLoginPublisher((push) => frames.push(push));

	const logins: [string, AuthType][] = [];
	const logout: string[] = [];
	let signal: AbortSignal | undefined;
	let interaction: AuthInteraction | undefined;

	const runtime = {
		login: (providerId: string, type: AuthType, i: AuthInteraction) => {
			logins.push([providerId, type]);
			signal = i.signal;
			interaction = i;
			return loginImpl(providerId, i);
		},
		logout: async (id: string) => {
			logout.push(id);
		},
	} as unknown as ModelRuntime;

	configurePiRuntime(runtime);
	return {
		frames,
		loginCalls: () => logins,
		logoutCalls: () => logout,
		lastSignal: () => signal,
		lastInteraction: () => interaction,
	};
}

afterEach(() => {
	cancelAllLogins();
	setLoginPublisher(() => {});
	configurePiRuntime(null);
});

describe("startLogin", () => {
	test("returns a handle synchronously (the flow runs detached, never awaited)", () => {
		// A login() that never settles must not block startLogin from returning its loginId.
		const { frames } = install(() => new Promise(() => {}));
		const { loginId } = startLogin("anthropic");
		expect(loginId).toMatch(/^login_\d+$/);
		expect(frames).toEqual([]); // nothing pushed yet — the flow hasn't produced a frame
	});

	test("device-code flow: pushes deviceCode, then success (as an oauth login)", async () => {
		const h = install(async (_id, i) => {
			i.notify({ type: "device_code", userCode: "WDJB-MJHT", verificationUri: "https://x/device" });
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
		expect(h.loginCalls()).toEqual([["github-copilot", "oauth"]]);
	});

	test("progress + info notifications stream through, then the terminal success frame", async () => {
		const h = install(async (_id, i) => {
			i.notify({ type: "progress", message: "Polling device…" });
			i.notify({ type: "device_code", userCode: "WDJB-MJHT", verificationUri: "https://x/device" });
			// `info` (possibly with links) renders as progress — links appended as plain URLs.
			i.notify({ type: "info", message: "See the docs", links: [{ url: "https://docs.example" }] });
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
		expect(h.frames[2]?.frame).toEqual({
			kind: "progress",
			message: "See the docs https://docs.example",
		});
	});

	test("select round-trip: a parked frame is answered by loginReply, then the flow completes", async () => {
		let chosen: string | undefined;
		const h = install(async (_id, i) => {
			chosen = await i.prompt({
				type: "select",
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

	test('an empty prompt reply reaches pi as "" — not swallowed as a cancel (Copilot github.com path)', async () => {
		let answered: string | undefined;
		const h = install(async (_id, i) => {
			answered = await i.prompt({
				type: "text",
				message: "GitHub Enterprise URL/domain (blank for github.com)",
				placeholder: "company.ghe.com",
			});
		});
		const { loginId } = startLogin("github-copilot");
		await tick();
		expect(h.frames.at(-1)?.frame).toEqual({
			kind: "prompt",
			message: "GitHub Enterprise URL/domain (blank for github.com)",
			placeholder: "company.ghe.com",
		});
		resolveLogin({ loginId, value: "" });
		await tick();
		expect(answered).toBe("");
		expect(h.frames.at(-1)?.frame.kind).toBe("success");
	});

	test("authUrl + concurrent paste: notify shows the URL while a manual_code prompt awaits a paste", async () => {
		let pasted: string | undefined;
		const h = install(async (_id, i) => {
			i.notify({ type: "auth_url", url: "https://provider/authorize?x=1" });
			// The browser-vs-paste race: in this test the paste wins.
			pasted = await i.prompt({ type: "manual_code", message: "Paste the authorization code" });
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

	test("pi aborting a prompt's signal (race lost) settles the parked input; a late reply is a no-op", async () => {
		const promptAbort = new AbortController();
		const h = install(async (_id, i) => {
			// The manual-code prompt loses to the callback server: pi aborts the prompt's own signal and
			// resolves the flow itself. Our parked input must settle (throw) without failing the login.
			await i
				.prompt({ type: "manual_code", message: "Paste code", signal: promptAbort.signal })
				.catch(() => "callback-won");
		});
		const { loginId } = startLogin("anthropic");
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt"]);
		promptAbort.abort();
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt", "success"]);
		resolveLogin({ loginId, value: "late" }); // parked input is gone — must not throw or resurrect
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt", "success"]);
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
	});
});

describe("cancelLogin", () => {
	test("aborts the signal AND rejects the parked prompt — and pushes no stray terminal frame", async () => {
		const h = install(async (_id, i) => {
			// Parks forever unless the parked prompt is settled by cancel (which makes prompt() throw).
			await i.prompt({ type: "text", message: "Paste code" });
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

	test("an interaction firing after cancel pushes no stray frame (push guards on settled)", async () => {
		const h = install(async (_id, i) => {
			await i.prompt({ type: "text", message: "code" });
		});
		const { loginId } = startLogin("anthropic");
		await tick();
		cancelLogin(loginId);
		await tick();
		// pi's detached flow may notify after we've cancelled — the guard must swallow it.
		h.lastInteraction()?.notify({ type: "progress", message: "late progress" });
		h.lastInteraction()?.notify({ type: "auth_url", url: "https://late" });
		await tick();
		expect(h.frames.map((f) => f.frame.kind)).toEqual(["prompt"]);
	});

	test("a reply after cancel is a no-op (the login is gone)", async () => {
		const h = install(async (_id, i) => {
			await i.prompt({ type: "text", message: "code" });
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
		install(async (_id, i) => {
			signals.push(i.signal);
			await i.prompt({ type: "text", message: "code" });
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
	test("setProviderApiKey persists via login(id, 'api_key') answering the secret prompt with the key", async () => {
		let stored: string | undefined;
		const h = install(async (_id, i) => {
			stored = await i.prompt({ type: "secret", message: "API key" });
		});
		await setProviderApiKey("openai", "  sk-abc  ");
		expect(stored).toBe("sk-abc"); // trimmed
		expect(h.loginCalls()).toEqual([["openai", "api_key"]]);
	});

	test("setProviderApiKey rejects an empty/blank key", async () => {
		install(async () => {});
		await expect(setProviderApiKey("openai", "   ")).rejects.toThrow(/must not be empty/);
	});

	test("logoutProvider removes the credential through the runtime", async () => {
		const h = install(async () => {});
		await logoutProvider("anthropic");
		expect(h.logoutCalls()).toEqual(["anthropic"]);
	});
});
