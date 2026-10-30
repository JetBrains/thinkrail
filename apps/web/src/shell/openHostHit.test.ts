import { describe, expect, test } from "bun:test";
import { MATCH_TIER, type SearchHit } from "@thinkrail/contracts";
import { type HostHitTargets, openHostHit } from "./openHostHit";

function targets(navigates: boolean) {
	const calls: string[] = [];
	const record: HostHitTargets = {
		navigateToWorkspace: async (workspace, sessionId) => {
			calls.push(`navigate ${workspace.id}${sessionId ? ` ${sessionId}` : ""}`);
			return navigates;
		},
		loadWorkspaceRow: async (workspace) => {
			calls.push(`load ${workspace.id}`);
			return navigates;
		},
		openFile: async (workspaceId, path) => {
			calls.push(`file ${workspaceId} ${path}`);
		},
		openSpec: (workspaceId, path) => calls.push(`spec ${workspaceId} ${path}`),
		openChatLocation: (location) =>
			calls.push(`chat ${location.sessionId}@${location.messageIndex} ${location.anchorText}`),
		openPlan: (workspaceId) => calls.push(`plan ${workspaceId}`),
	};
	return { record, calls };
}

const hit = (overrides: Partial<SearchHit> & Pick<SearchHit, "kind">): SearchHit => ({
	id: `${overrides.kind}:x`,
	title: "x",
	tier: MATCH_TIER.prefix,
	score: 1,
	projectId: "p1",
	workspaceId: "w1",
	...overrides,
});

async function open(target: SearchHit, navigates = true): Promise<string[]> {
	const { record, calls } = targets(navigates);
	await openHostHit(target, record);
	return calls;
}

describe("openHostHit", () => {
	test("a file, spec or plan opens only once its workspace is entered", async () => {
		expect(await open(hit({ kind: "file", path: "src/a.ts" }))).toEqual([
			"navigate w1",
			"file w1 src/a.ts",
		]);
		expect(await open(hit({ kind: "spec", path: "SPEC.md" }))).toEqual([
			"navigate w1",
			"spec w1 SPEC.md",
		]);
		expect(await open(hit({ kind: "plan", sessionId: "s1" }))).toEqual([
			"navigate w1 s1",
			"plan w1",
		]);
		expect(await open(hit({ kind: "file", path: "src/a.ts" }), false)).toEqual(["navigate w1"]);
		expect(await open(hit({ kind: "spec", path: "SPEC.md" }), false)).toEqual(["navigate w1"]);
		expect(await open(hit({ kind: "plan", sessionId: "s1" }), false)).toEqual(["navigate w1 s1"]);
	});

	test("a transcript jumps to its message once the workspace row is known, else opens its chat", async () => {
		const transcript = hit({
			kind: "transcript",
			sessionId: "s1",
			messageIndex: 3,
			anchorText: "the refresh",
		});
		expect(await open(transcript)).toEqual(["load w1", "chat s1@3 the refresh"]);
		expect(await open(transcript, false)).toEqual(["load w1"]);
		expect(await open(hit({ kind: "transcript", sessionId: "s1" }))).toEqual(["navigate w1 s1"]);
	});

	test("a chat or workspace navigates, and a hit without a workspace does nothing", async () => {
		expect(await open(hit({ kind: "chat", sessionId: "s1" }))).toEqual(["navigate w1 s1"]);
		expect(await open(hit({ kind: "workspace" }))).toEqual(["navigate w1"]);
		const { workspaceId: _, ...homeless } = hit({ kind: "file", path: "a.ts" });
		expect(await open(homeless)).toEqual([]);
	});
});
