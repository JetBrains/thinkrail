import { describe, expect, it, mock } from "bun:test";
import type { ExtensionHostServices, ExtensionQuery } from "@thinkrail/extension-api/server";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { createExtensionQueries } from "./queries";
import type { ServerExtensionEntry } from "./registry";

const refused = async (): Promise<never> => {
	throw new Error("no host actions in this test");
};

function services(name: string, signal: AbortSignal): ExtensionHostServices {
	return {
		dataDir: `/data/extensions/${name}`,
		log: { info: () => {}, warn: () => {} },
		signal,
		actions: {
			createWorkspace: refused,
			startChat: refused,
			sendToChat: refused,
			stopChat: refused,
			openPr: refused,
			runInWorkspace: refused,
			writeWorkspaceFile: refused,
			assist: refused,
		},
		events: { subscribe: () => () => {} },
		publish: () => {},
		workspaceFacts: async () => null,
		taskSpecs: async () => null,
		specSection: async () => null,
		githubProblem: async () => null,
		sessionsRoot: () => "/agent/sessions",
		sessionScope: () => ({ projects: [], locate: () => null }),
		childTranscriptDirs: async () => [],
		sessionStatus: () => ({ live: false, completion: null }),
		messageAnchor: async () => null,
		contextWindow: async () => null,
		models: async () => [],
		turnReceipts: async () => [],
		turnTree: async () => null,
		ensureArtifactsDir: async () => null,
	};
}

async function codeOf(answer: Promise<unknown>): Promise<string | undefined> {
	try {
		await answer;
	} catch (error) {
		return errorCodeOf(error);
	}
	throw new Error("expected a refusal");
}

function setup(options: { disabled?: Set<string> } = {}) {
	const disabled = options.disabled ?? new Set<string>();
	const echo = mock<ExtensionQuery>((params) => ({ echoed: params }));
	const built = mock((host: ExtensionHostServices) => ({
		echo,
		dataDir: () => host.dataDir,
		fails: async () => {
			throw new Error("the query failed");
		},
	}));
	const entries: ServerExtensionEntry[] = [
		{
			specifier: "@acme/insights/server",
			extension: { name: "insights", extensions: [], apiVersion: 1, queries: built },
		},
		{ specifier: "@acme/plain/server", extension: { name: "plain", extensions: [] } },
	];
	const servicesFor = mock(services);
	const { query, releaseDisabled } = createExtensionQueries({
		isDisabled: (name) => disabled.has(name),
		services: servicesFor,
		entries,
	});
	return { query, releaseDisabled, built, echo, servicesFor, disabled };
}

describe("createExtensionQueries", () => {
	it("answers a declared method with the extension's own result and leaves params to it", async () => {
		const { query, echo } = setup();
		expect(
			await query({ extension: "insights", method: "echo", params: { scope: "anything" } }),
		).toEqual({ echoed: { scope: "anything" } });
		expect(await query({ extension: "insights", method: "echo" })).toEqual({ echoed: undefined });
		expect(echo).toHaveBeenCalledTimes(2);
	});

	it("builds an extension's queries once, lazily, with that extension's services", async () => {
		const { query, built, servicesFor } = setup();
		expect(built).not.toHaveBeenCalled();
		expect(await query({ extension: "insights", method: "dataDir" })).toBe(
			"/data/extensions/insights",
		);
		await query({ extension: "insights", method: "echo" });
		await query({ extension: "insights", method: "missing" }).catch(() => undefined);
		expect(built).toHaveBeenCalledTimes(1);
		expect(servicesFor.mock.calls.map(([name]) => name)).toEqual(["insights"]);
	});

	it("refuses unknown extensions, extensions without queries, unknown methods and malformed requests", async () => {
		const { query, built } = setup();
		expect(await codeOf(query({ extension: "retired", method: "echo" }))).toBe(
			"UNKNOWN_EXTENSION_QUERY",
		);
		expect(await codeOf(query({ extension: "plain", method: "echo" }))).toBe(
			"UNKNOWN_EXTENSION_QUERY",
		);
		expect(await codeOf(query({ extension: "insights", method: "toString" }))).toBe(
			"UNKNOWN_EXTENSION_QUERY",
		);
		expect(await codeOf(query({ extension: "insights", method: "missing" }))).toBe(
			"UNKNOWN_EXTENSION_QUERY",
		);
		for (const malformed of [null, "insights", { extension: "insights" }, { method: "echo" }]) {
			expect(await codeOf(query(malformed))).toBe("UNKNOWN_EXTENSION_QUERY");
		}
		expect(await codeOf(query({ extension: 1, method: "echo" }))).toBe("UNKNOWN_EXTENSION_QUERY");
		expect(built).toHaveBeenCalledTimes(1);
	});

	it("refuses a disabled extension on every call without building it, and answers again once re-enabled", async () => {
		const { query, built, echo, disabled } = setup({ disabled: new Set(["insights", "plain"]) });
		expect(await codeOf(query({ extension: "insights", method: "echo" }))).toBe(
			"EXTENSION_DISABLED",
		);
		expect(await codeOf(query({ extension: "insights", method: "missing" }))).toBe(
			"EXTENSION_DISABLED",
		);
		expect(await codeOf(query({ extension: "plain", method: "echo" }))).toBe("EXTENSION_DISABLED");
		expect(built).not.toHaveBeenCalled();

		disabled.delete("insights");
		expect(await query({ extension: "insights", method: "echo", params: 1 })).toEqual({
			echoed: 1,
		});
		disabled.add("insights");
		expect(await codeOf(query({ extension: "insights", method: "echo" }))).toBe(
			"EXTENSION_DISABLED",
		);
		disabled.delete("insights");
		await query({ extension: "insights", method: "echo" });
		expect(built).toHaveBeenCalledTimes(1);
		expect(echo).toHaveBeenCalledTimes(2);
	});

	it("aborts a switched-off extension's table and builds a new one with a fresh signal once it is back on", async () => {
		const { query, releaseDisabled, built, servicesFor, disabled } = setup();
		await query({ extension: "insights", method: "echo" });
		const [[, first]] = servicesFor.mock.calls as [[string, AbortSignal]];
		releaseDisabled();
		expect(first.aborted).toBe(false);

		disabled.add("insights");
		releaseDisabled();
		expect(first.aborted).toBe(true);
		expect(errorCodeOf(first.reason)).toBe("EXTENSION_DISABLED");
		expect(await codeOf(query({ extension: "insights", method: "echo" }))).toBe(
			"EXTENSION_DISABLED",
		);
		expect(built).toHaveBeenCalledTimes(1);

		disabled.delete("insights");
		releaseDisabled();
		expect(await query({ extension: "insights", method: "echo", params: 2 })).toEqual({
			echoed: 2,
		});
		expect(built).toHaveBeenCalledTimes(2);
		const second = servicesFor.mock.calls[1]?.[1];
		expect(second).not.toBe(first);
		expect(second?.aborted).toBe(false);
	});

	it("releases only the extensions that are off, and nothing it never built", async () => {
		const { query, releaseDisabled, built, servicesFor, disabled } = setup();
		disabled.add("plain");
		releaseDisabled();
		await query({ extension: "insights", method: "echo" });
		releaseDisabled();
		expect(servicesFor.mock.calls[0]?.[1].aborted).toBe(false);
		await query({ extension: "insights", method: "echo" });
		expect(built).toHaveBeenCalledTimes(1);
	});

	it("propagates an error a query throws unchanged", async () => {
		const { query } = setup();
		const answer = query({ extension: "insights", method: "fails" });
		await expect(answer).rejects.toThrow("the query failed");
		expect(await codeOf(query({ extension: "insights", method: "fails" }))).toBeUndefined();
	});

	it("defaults to the shipped registry, where an extension without queries has none to answer", async () => {
		const { query } = createExtensionQueries({ isDisabled: () => false, services });
		expect(await codeOf(query({ extension: "visualize", method: "anything" }))).toBe(
			"UNKNOWN_EXTENSION_QUERY",
		);
	});
});
