import type { AuthInteraction, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import type { LoginFrame, LoginPush, LoginReply } from "@thinkrail/contracts";
import { usePiRuntime } from "../agent";

let publish: (push: LoginPush) => void = () => {};
export function setLoginPublisher(fn: (push: LoginPush) => void): void {
	publish = fn;
}

let seq = 0;
const nextId = (): string => `login_${++seq}`;

interface Pending {
	providerId: string;
	abort: AbortController;
	resolveInput?: (value: string | undefined) => void;
	settled: boolean;
}
const logins = new Map<string, Pending>();

function terminate(loginId: string): Pending | undefined {
	const entry = logins.get(loginId);
	if (!entry || entry.settled) return undefined;
	entry.settled = true;
	logins.delete(loginId);
	return entry;
}

function frameForPrompt(prompt: AuthPrompt): LoginFrame {
	if (prompt.type === "select") {
		return {
			kind: "select",
			message: prompt.message,
			options: prompt.options.map((o) => ({ id: o.id, label: o.label })),
		};
	}
	return {
		kind: "prompt",
		message: prompt.message,
		...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
		...(prompt.type === "text" ? { allowEmpty: true } : {}),
		...(prompt.type === "secret" ? { secret: true } : {}),
	};
}

export function startLogin(providerId: string, type: AuthType = "oauth"): { loginId: string } {
	const loginId = nextId();
	const entry: Pending = { providerId, abort: new AbortController(), settled: false };
	logins.set(loginId, entry);

	const push = (frame: LoginFrame): void => {
		if (!entry.settled) publish({ loginId, providerId, frame });
	};

	const awaitInput = (frame: LoginFrame, signal?: AbortSignal): Promise<string | undefined> =>
		new Promise((resolve) => {
			const settle = (value: string | undefined): void => {
				if (entry.resolveInput === settle) delete entry.resolveInput;
				resolve(value);
			};
			entry.resolveInput = settle;
			signal?.addEventListener("abort", () => settle(undefined), { once: true });
			push(frame);
		});

	const interaction: AuthInteraction = {
		signal: entry.abort.signal,
		notify: (event) => {
			switch (event.type) {
				case "auth_url":
					push({
						kind: "authUrl",
						url: event.url,
						...(event.instructions ? { instructions: event.instructions } : {}),
					});
					break;
				case "device_code":
					push({
						kind: "deviceCode",
						userCode: event.userCode,
						verificationUri: event.verificationUri,
						...(event.expiresInSeconds ? { expiresInSeconds: event.expiresInSeconds } : {}),
					});
					break;
				case "progress":
					push({ kind: "progress", message: event.message });
					break;
				case "info":
					push({
						kind: "progress",
						message: [event.message, ...(event.links ?? []).map((l) => l.url)].join(" "),
					});
					break;
			}
		},
		prompt: async (prompt) => {
			const value = await awaitInput(frameForPrompt(prompt), prompt.signal);
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
	};

	const publishTerminal = (frame: LoginFrame): void => publish({ loginId, providerId, frame });

	void usePiRuntime((runtime) => runtime.login(providerId, type, interaction))
		.then(() => {
			if (terminate(loginId)) publishTerminal({ kind: "success" });
		})
		.catch((err: unknown) => {
			if (terminate(loginId)) {
				publishTerminal({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			}
		});

	return { loginId };
}

export function resolveLogin(reply: LoginReply): void {
	logins.get(reply.loginId)?.resolveInput?.(reply.value);
}

export function cancelLogin(loginId: string): void {
	const entry = terminate(loginId);
	if (!entry) return;
	entry.abort.abort();
	entry.resolveInput?.(undefined);
}

export function cancelAllLogins(): void {
	for (const loginId of [...logins.keys()]) cancelLogin(loginId);
}

export function logoutProvider(providerId: string): Promise<void> {
	return usePiRuntime((runtime) => runtime.logout(providerId));
}
