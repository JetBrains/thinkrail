import { createHash } from "node:crypto";
import { CodedError } from "@thinkrail/shared/codedError";

export type IssueSecretsBackend = Pick<typeof Bun.secrets, "get" | "set" | "delete">;

export interface IssueCredentials {
	/** Trusted host callers only: never serialize this result. */
	get(credentialId: string): Promise<string | null>;
	set(credentialId: string, token: string): Promise<void>;
	delete(credentialId: string): Promise<void>;
}

function unavailable(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue credentials are unavailable.");
}

function account(namespace: string, credentialId: string): { service: string; name: string } {
	if (
		typeof namespace !== "string" ||
		namespace.length === 0 ||
		namespace.length > 4096 ||
		namespace.trim().length === 0 ||
		Array.from(namespace).some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		}) ||
		typeof credentialId !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(credentialId) ||
		credentialId.length !== 36
	)
		unavailable();
	const digest = createHash("sha256")
		.update(JSON.stringify([namespace, credentialId]))
		.digest("hex");
	return { service: "ThinkRailIssues", name: `v1-${digest}` };
}

function validToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 4096 &&
		/^[\x20-\x7e]+$/.test(value) &&
		value.trim().length > 0
	);
}

/**
 * OS-vault primitive only, not a connect transaction or credential lifecycle manager.
 * Import and factory creation do not access the vault; tests must inject a disposable backend.
 */
export function createIssueCredentials(options: {
	namespace: string;
	secrets?: IssueSecretsBackend;
	platform?: NodeJS.Platform;
}): IssueCredentials {
	return {
		async get(credentialId) {
			try {
				const key = account(options.namespace, credentialId);
				const value = await (options.secrets ?? Bun.secrets).get(key);
				if (value !== null && !validToken(value)) unavailable();
				return value;
			} catch {
				return unavailable();
			}
		},
		async set(credentialId, token) {
			try {
				const key = account(options.namespace, credentialId);
				if (!validToken(token)) unavailable();
				const result = await (options.secrets ?? Bun.secrets).set({
					...key,
					value: token,
					...((options.platform ?? process.platform) === "win32"
						? { persist: "local" as const }
						: {}),
				});
				if (result !== undefined) unavailable();
			} catch {
				unavailable();
			}
		},
		async delete(credentialId) {
			try {
				const result = await (options.secrets ?? Bun.secrets).delete(
					account(options.namespace, credentialId),
				);
				if (typeof result !== "boolean") unavailable();
			} catch {
				unavailable();
			}
		},
	};
}
