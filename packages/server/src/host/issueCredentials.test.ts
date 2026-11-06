import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CodedError } from "@thinkrail/shared/codedError";
import { createIssueCredentials, type IssueSecretsBackend } from "./issueCredentials";

const namespace = "C:/profiles/primary/thinkrail";
const credentialId = "731420e4-59c5-43ba-8b9c-c64082feae91";
const nextCredentialId = "09933201-4b8f-41a9-a86b-112b7b730f4b";
const token = " glpat-private-token ";

function fixture(platform: NodeJS.Platform = "linux") {
	const values = new Map<string, string>();
	const calls: { operation: string; options: Record<string, unknown> }[] = [];
	const backend: IssueSecretsBackend = {
		async get(options) {
			calls.push({ operation: "get", options });
			return values.get(JSON.stringify(options)) ?? null;
		},
		async set(options) {
			calls.push({ operation: "set", options });
			values.set(JSON.stringify({ service: options.service, name: options.name }), options.value);
		},
		async delete(options) {
			calls.push({ operation: "delete", options });
			return values.delete(JSON.stringify(options));
		},
	};
	return {
		store: createIssueCredentials({ namespace, secrets: backend, platform }),
		backend,
		calls,
	};
}

async function sanitized(operation: () => Promise<unknown>) {
	try {
		await operation();
		throw new Error("Expected rejection");
	} catch (error) {
		expect(error).toBeInstanceOf(CodedError);
		expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
		expect((error as Error).message).toBe("Issue credentials are unavailable.");
		expect(Object.hasOwn(error as object, "cause")).toBe(false);
		expect(JSON.stringify(error)).not.toContain(token);
	}
}

describe("host-only Issue OS credentials", () => {
	test("profiles sharing a vault isolate the same credential ID", async () => {
		const { store, backend } = fixture();
		const other = createIssueCredentials({
			namespace: "C:/profiles/other/thinkrail",
			secrets: backend,
		});
		await store.set(credentialId, token);
		expect(await other.get(credentialId)).toBeNull();
		await other.set(credentialId, "other-profile-token");
		expect(await store.get(credentialId)).toBe(token);
		await other.delete(credentialId);
		expect(await store.get(credentialId)).toBe(token);
		expect(await createIssueCredentials({ namespace, secrets: backend }).get(credentialId)).toBe(
			token,
		);
	});

	test("two service-allocated generations for one binding cannot overwrite or delete each other", async () => {
		const { store } = fixture();
		await store.set(credentialId, token);
		await store.set(nextCredentialId, "replacement-token");
		expect(await store.get(credentialId)).toBe(token);
		expect(await store.get(nextCredentialId)).toBe("replacement-token");
		await store.delete(credentialId);
		expect(await store.get(nextCredentialId)).toBe("replacement-token");
		await store.set(credentialId, token);
		await store.delete(nextCredentialId);
		expect(await store.get(credentialId)).toBe(token);
	});

	test("import and construction are lazy; no real backend is invoked", () => {
		expect(createIssueCredentials({ namespace })).toBeDefined();
		expect(fixture().calls).toEqual([]);
	});

	for (const platform of ["win32", "darwin", "linux"] as const) {
		test(`${platform}: disposable vault roundtrip, exact token and platform options`, async () => {
			const { store, calls } = fixture(platform);
			expect(await store.get(credentialId)).toBeNull();
			expect(await store.set(credentialId, token)).toBeUndefined();
			expect(await store.get(credentialId)).toBe(token);
			expect(await store.delete(credentialId)).toBeUndefined();
			expect(await store.get(credentialId)).toBeNull();
			expect(await store.delete(credentialId)).toBeUndefined();
			const name = `v1-${createHash("sha256")
				.update(JSON.stringify([namespace, credentialId]))
				.digest("hex")}`;
			for (const call of calls) {
				expect(call.options.service).toBe("ThinkRailIssues");
				expect(call.options.name).toBe(name);
				if (call.operation === "set") {
					expect(call.options).toEqual({
						service: "ThinkRailIssues",
						name,
						value: token,
						...(platform === "win32" ? { persist: "local" } : {}),
					});
				} else expect(call.options).toEqual({ service: "ThinkRailIssues", name });
			}
			expect(name).not.toContain(namespace);
			expect(name).not.toContain(credentialId);
			expect(name).not.toContain(token);
		});
	}

	test("rejects noncanonical UUIDs before vault access", async () => {
		const { store, calls } = fixture();
		for (const input of [
			null,
			{},
			123,
			"",
			"binding-id",
			credentialId.toUpperCase(),
			` ${credentialId}`,
			`${credentialId}\n`,
			credentialId.replaceAll("-", ""),
			"00000000-0000-0000-0000-000000000000",
			"731420e4-59c5-43ba-7b9c-c64082feae91",
		]) {
			const value = input as string;
			await sanitized(() => store.get(value));
			await sanitized(() => store.set(value, token));
			await sanitized(() => store.delete(value));
		}
		expect(calls).toEqual([]);
	});

	test("invalid namespaces fail closed before vault access", async () => {
		const { backend, calls } = fixture();
		for (const input of [null, 123, "", " ", "profile\n", "x".repeat(4097)]) {
			const store = createIssueCredentials({ namespace: input as string, secrets: backend });
			await sanitized(() => store.get(credentialId));
			await sanitized(() => store.set(credentialId, token));
			await sanitized(() => store.delete(credentialId));
		}
		expect(calls).toEqual([]);
	});

	test("token validation is bounded printable ASCII, without silently trimming", async () => {
		const { store, calls } = fixture();
		for (const value of [
			null,
			123,
			"",
			" ",
			"\t",
			"secret\n",
			"secret\x7f",
			"secrét",
			"x".repeat(4097),
		]) {
			await sanitized(() => store.set(credentialId, value as string));
		}
		expect(calls).toEqual([]);
		await store.set(credentialId, "x".repeat(4096));
		expect(await store.get(credentialId)).toHaveLength(4096);
	});

	test("backend throws and malformed results are sanitized for every operation", async () => {
		for (const thrown of [new Error(token), token, { cause: token }]) {
			const fail = () => {
				throw thrown;
			};
			const store = createIssueCredentials({
				namespace,
				secrets: { get: fail, set: fail, delete: fail },
				platform: "linux",
			});
			await sanitized(() => store.get(credentialId));
			await sanitized(() => store.set(credentialId, token));
			await sanitized(() => store.delete(credentialId));
		}
		for (const result of [undefined, 1, {}, "", " ", "bad\n", "x".repeat(4097)]) {
			const { backend } = fixture();
			backend.get = async () => result as string;
			await sanitized(() =>
				createIssueCredentials({ namespace, secrets: backend }).get(credentialId),
			);
		}
		const { backend } = fixture();
		backend.set = async () => token as never;
		backend.delete = async () => token as never;
		const store = createIssueCredentials({ namespace, secrets: backend });
		await sanitized(() => store.set(credentialId, token));
		await sanitized(() => store.delete(credentialId));
	});
});
