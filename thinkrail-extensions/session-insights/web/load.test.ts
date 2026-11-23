import { describe, expect, mock, test } from "bun:test";
import type { PanelChatTarget, PanelHost } from "@thinkrail/extension-api/web";
import { listResult, sessionRow } from "./fixtures.test";
import {
	chatTarget,
	hostServesThisVersion,
	listFailure,
	listScope,
	loadSessions,
	openAnalysis,
	openSession,
} from "./load";

function fakeHost(answer: (method: string, params: unknown) => Promise<unknown>) {
	const queries: { method: string; params: unknown; signal: AbortSignal | undefined }[] = [];
	const opened: PanelChatTarget[] = [];
	const panels: { panel: string; params: unknown; title: string | undefined }[] = [];
	const host: PanelHost = {
		query: (method, params, signal) => {
			queries.push({ method, params, signal });
			return answer(method, params);
		},
		openChat: (target) => opened.push(target),
		openPanel: (panel, params, title) => panels.push({ panel, params, title }),
		renderToolCall: () => null,
		openFile: () => {},
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: 11,
	};
	return { host, queries, opened, panels };
}

describe("loadSessions", () => {
	test("asks the host's sessions.list for the chosen scope and hands the result through", async () => {
		const result = listResult([sessionRow("s1")]);
		const fake = fakeHost(async () => result);
		const signal = new AbortController().signal;
		expect(await loadSessions(fake.host, listScope(fake.host, "project"), signal)).toEqual({
			kind: "ok",
			result,
		});
		await loadSessions(fake.host, listScope(fake.host, "all"), signal, true);
		expect(fake.queries).toEqual([
			{ method: "sessions.list", params: { scope: { kind: "project", projectId: "p1" } }, signal },
			{ method: "sessions.list", params: { scope: { kind: "all" }, fresh: true }, signal },
		]);
	});

	test("a payload of another version is a version notice, never a misread", async () => {
		for (const payload of [{ ...listResult([]), apiVersion: 1 }, { rows: [] }, null, "rows"]) {
			const fake = fakeHost(async () => payload);
			expect(await loadSessions(fake.host, { kind: "all" }, new AbortController().signal)).toEqual({
				kind: "version",
			});
		}
	});

	test("the host's coded refusals propagate for the panel to word", async () => {
		const refusal = Object.assign(new Error("off"), { code: "EXTENSION_DISABLED" });
		const fake = fakeHost(() => Promise.reject(refusal));
		await expect(
			loadSessions(fake.host, { kind: "all" }, new AbortController().signal),
		).rejects.toBe(refusal);
	});
});

test("refusals map to the panel's three failure states by code only", () => {
	expect(listFailure(Object.assign(new Error("x"), { code: "EXTENSION_DISABLED" }))).toBe(
		"disabled",
	);
	expect(listFailure(Object.assign(new Error("x"), { code: "UNKNOWN_EXTENSION_QUERY" }))).toBe(
		"updateHost",
	);
	expect(listFailure(new Error("Invalid sessions.list params"))).toBe("failed");
	expect(listFailure("boom")).toBe("failed");
});

test("the panel trusts only its own server half's version", () => {
	const fake = fakeHost(async () => null);
	expect(hostServesThisVersion(fake.host)).toBe(true);
	expect(hostServesThisVersion({ ...fake.host, hostApiVersion: undefined })).toBe(false);
	expect(hostServesThisVersion({ ...fake.host, hostApiVersion: 1 })).toBe(false);
});

describe("opening a session", () => {
	test("opens the chat in its own project and workspace", () => {
		const fake = fakeHost(async () => null);
		const open = mock(fake.host.openChat);
		const host = { ...fake.host, openChat: open };
		const row = sessionRow("s1", { projectId: "p2", workspaceId: "w9" });
		expect(chatTarget(row)).toEqual({ projectId: "p2", workspaceId: "w9", sessionId: "s1" });
		expect(openSession(host, row)).toBe(true);
		expect(open).toHaveBeenCalledTimes(1);
		expect(open.mock.calls[0]).toEqual([{ projectId: "p2", workspaceId: "w9", sessionId: "s1" }]);
	});

	test("sessions of a removed workspace or outside every project have nowhere to open", () => {
		const fake = fakeHost(async () => null);
		const removed = sessionRow("gone", {
			workspaceId: null,
			workspaceName: "old",
			workspaceState: "removed",
		});
		const outside = sessionRow("orphan", {
			projectId: null,
			workspaceId: null,
			workspaceName: null,
			workspaceState: "none",
		});
		for (const row of [removed, outside]) {
			expect(chatTarget(row)).toBeNull();
			expect(openSession(fake.host, row)).toBe(false);
		}
		expect(fake.opened).toEqual([]);
	});
});

test("the analysis opens as the session panel, one tab per session, named after it", () => {
	const fake = fakeHost(async () => null);
	openAnalysis(fake.host, sessionRow("s1"), "Fix the login flow");
	openAnalysis(
		fake.host,
		sessionRow("gone", { workspaceState: "removed", workspaceId: null }),
		"Old",
	);
	expect(fake.panels).toEqual([
		{ panel: "session", params: { sessionId: "s1" }, title: "Fix the login flow" },
		{ panel: "session", params: { sessionId: "gone" }, title: "Old" },
	]);
});
