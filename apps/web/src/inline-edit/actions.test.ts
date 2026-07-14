import { beforeEach, expect, mock, test } from "bun:test";
import type { InlineEditRequest } from "@/store";
import type { SelectionTarget } from "./types";

// A controllable fake transport: records outgoing requests and lets a test force an fs.writeFile conflict.
// Injected before importing actions — getTransport() throws without a real WS, so the mock stands in.
type Sent = { method: string; params: Record<string, unknown> };
const sent: Sent[] = [];
let writeRejects = false;

const fakeTransport = {
	request: async (method: string, params: Record<string, unknown>) => {
		sent.push({ method, params });
		switch (method) {
			case "fs.readFile":
				return { content: "DISK" };
			case "session.create":
				return { sessionId: "s-new", model: null, thinkingLevel: "medium" };
			case "fs.writeFile":
				if (writeRejects) throw new Error("File changed on disk");
				return { ok: true };
			default:
				return {};
		}
	},
};

mock.module("@/transport", () => ({
	getTransport: () => fakeTransport,
	errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { startInlineEdit, undoLastChange, revertAll, hasPendingEditForPath } = await import(
	"./actions"
);
const { useAppStore } = await import("@/store");

beforeEach(() => {
	useAppStore.setState({
		sessions: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		closedChatsByWorkspace: {},
		activeWorkspaceId: null,
		inlineEdits: {},
		inlineEditBySession: {},
	});
	sent.length = 0;
	writeRejects = false;
});

/** Seed a request under review with the given per-turn base snapshots and the current on-disk `afterContent`. */
function seedReview(turnBases: string[], afterContent: string): string {
	const id = "req-test";
	const req: InlineEditRequest = {
		id,
		workspaceId: "w1",
		path: "doc.md",
		sessionId: "sess-test",
		selection: { text: "x", startLine: 1, endLine: 1 },
		turns: turnBases.map((baseContent, i) => ({
			instruction: `t${i + 1}`,
			baseContent,
			hunks: [],
			pendingTools: {},
			otherPaths: [],
		})),
		status: "review",
	};
	const store = useAppStore.getState();
	store.registerInlineEdit(req, null, "medium");
	store.setInlineEditAfterContent(id, afterContent);
	return id;
}

const lastWrite = () => sent.filter((s) => s.method === "fs.writeFile").at(-1);

test("undoLastChange restores the current turn's base, pops the turn, and syncs the write guard", async () => {
	const id = seedReview(["ORIG", "AFTER_T1"], "AFTER_T2");

	// First undo → write turn-2 base (AFTER_T1), guarded by the current on-disk content (AFTER_T2).
	const r1 = await undoLastChange(id);
	expect(r1.ok).toBe(true);
	expect(lastWrite()?.params.content).toBe("AFTER_T1");
	expect(lastWrite()?.params.ifMatchContent).toBe("AFTER_T2");
	const mid = useAppStore.getState().inlineEdits[id];
	expect(mid?.turns).toHaveLength(1); // popped back to the first turn
	expect(mid?.status).toBe("review");
	expect(mid?.afterContent).toBe("AFTER_T1"); // guard synced to what was just written

	// Second undo → write turn-1 base (ORIG), guarded by the SYNCED guard (AFTER_T1) — NOT the stale AFTER_T2.
	const r2 = await undoLastChange(id);
	expect(r2.ok).toBe(true);
	expect(lastWrite()?.params.content).toBe("ORIG");
	expect(lastWrite()?.params.ifMatchContent).toBe("AFTER_T1");
	expect(useAppStore.getState().inlineEdits[id]).toBeUndefined(); // only turn left → fully reverted
});

test("revertAll restores turns[0].baseContent regardless of refine depth, then resolves", async () => {
	const id = seedReview(["ORIG", "AFTER_T1"], "AFTER_T2");
	const res = await revertAll(id);
	expect(res.ok).toBe(true);
	expect(lastWrite()?.params.content).toBe("ORIG"); // fire-time original
	expect(lastWrite()?.params.ifMatchContent).toBe("AFTER_T2");
	expect(useAppStore.getState().inlineEdits[id]).toBeUndefined();
});

test("a write conflict on undo leaves the request in review with all turns intact (no data loss)", async () => {
	writeRejects = true;
	const id = seedReview(["ORIG", "AFTER_T1"], "AFTER_T2");
	const res = await undoLastChange(id);
	expect(res.ok).toBe(false);
	const live = useAppStore.getState().inlineEdits[id];
	expect(live?.turns).toHaveLength(2); // nothing popped
	expect(live?.status).toBe("review"); // reverted status is transient — back to review, not stuck
});

test("startInlineEdit refuses a second pending edit on the same file (one pending per file)", async () => {
	seedReview(["ORIG"], "AFTER");
	expect(hasPendingEditForPath("w1", "doc.md")).toBe(true);
	const target: SelectionTarget = {
		workspaceId: "w1",
		path: "doc.md",
		text: "x",
		startLine: 1,
		endLine: 1,
		rect: { top: 0, left: 0, bottom: 0, right: 0 },
	};
	const before = sent.length;
	const result = await startInlineEdit(target, "do something else");
	expect(result).toBeNull();
	// The refused fire never opened a session.
	expect(sent.slice(before).some((s) => s.method === "session.create")).toBe(false);
});
