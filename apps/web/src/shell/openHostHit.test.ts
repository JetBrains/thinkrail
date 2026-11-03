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

const base = { title: "x", tier: MATCH_TIER.prefix, score: 1, projectId: "p1", workspaceId: "w1" };
const file: SearchHit = { ...base, id: "file:x", kind: "file", path: "src/a.ts" };
const spec: SearchHit = {
	...base,
	id: "spec:x",
	kind: "spec",
	path: "SPEC.md",
	specId: "x",
	size: 1,
};
const plan: SearchHit = { ...base, id: "plan:x", kind: "plan", sessionId: "s1" };
const transcript: SearchHit = {
	...base,
	id: "transcript:x",
	kind: "transcript",
	sessionId: "s1",
	messageIndex: 3,
	anchorText: "the refresh",
};

async function open(target: SearchHit, navigates = true): Promise<string[]> {
	const { record, calls } = targets(navigates);
	await openHostHit(target, record);
	return calls;
}

describe("openHostHit", () => {
	test("a file, spec or plan opens only once its workspace is entered", async () => {
		expect(await open(file)).toEqual(["navigate w1", "file w1 src/a.ts"]);
		expect(await open(spec)).toEqual(["navigate w1", "spec w1 SPEC.md"]);
		expect(await open(plan)).toEqual(["navigate w1 s1", "plan w1"]);
		expect(await open(file, false)).toEqual(["navigate w1"]);
		expect(await open(spec, false)).toEqual(["navigate w1"]);
		expect(await open(plan, false)).toEqual(["navigate w1 s1"]);
	});

	test("a transcript jumps to its message once the workspace row is known", async () => {
		expect(await open(transcript)).toEqual(["load w1", "chat s1@3 the refresh"]);
		expect(await open(transcript, false)).toEqual(["load w1"]);
	});
});
