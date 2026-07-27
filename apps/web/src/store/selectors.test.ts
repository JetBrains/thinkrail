import { expect, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";
import type { EditorTab } from "./appStore";
import {
	isSkillPath,
	matchesWorktreePath,
	selectActiveWorkspace,
	selectActiveWorkspaceProjectId,
	selectContextProject,
	selectHistoryTarget,
	selectSkillsStale,
	specPathMatcher,
} from "./selectors";

const projects: Project[] = [
	{ id: "p1", name: "One", path: "/one", slug: "one", lastOpened: 1 },
	{ id: "p2", name: "Two", path: "/two", slug: "two", lastOpened: 2 },
];
const workspace: Workspace = {
	id: "w2",
	projectId: "p2",
	name: "Second workspace",
	branch: "second-workspace",
	worktreePath: "/two/workspace",
	baseBranch: "main",
};
const workspaces = { p1: [], p2: [workspace] };

test("active workspace selectors resolve the workspace and its owning project", () => {
	const state = { activeWorkspaceId: "w2", workspaces };

	expect(selectActiveWorkspace(state)).toBe(workspace);
	expect(selectActiveWorkspaceProjectId(state)).toBe("p2");
});

test("active workspace selectors return null when the workspace is absent", () => {
	const state = { activeWorkspaceId: "missing", workspaces };

	expect(selectActiveWorkspace(state)).toBeNull();
	expect(selectActiveWorkspaceProjectId(state)).toBeNull();
});

test("context project prefers the active workspace owner", () => {
	expect(
		selectContextProject({
			activeWorkspaceId: "w2",
			selectedProjectId: "p1",
			projects,
			workspaces,
		}),
	).toBe(projects[1]);
});

test("context project falls back to the selected Project Home", () => {
	expect(
		selectContextProject({
			activeWorkspaceId: null,
			selectedProjectId: "p1",
			projects,
			workspaces,
		}),
	).toBe(projects[0]);
});

test("isSkillPath matches every alias' skills dir, and only a real skills dir", () => {
	for (const yes of [
		".claude/skills/foo/SKILL.md",
		".github/skills/x.md",
		".gemini/skills",
		".agents/skills/z",
		"nested/dir/.pi/skills/y.md",
	]) {
		expect(isSkillPath(yes)).toBe(true);
	}
	for (const no of [
		"README.md",
		".claude/settings.json", // an alias dir, but not its skills
		".claudeskills/x", // no `/skills` segment
		"src/claude/skills/x", // "claude" without the leading dot
		"skills/x", // bare skills, no alias parent
	]) {
		expect(isSkillPath(no)).toBe(false);
	}
});

test("selectSkillsStale is a strict tick comparison, defaulting missing ticks to 0", () => {
	const stale = { skillChangeTickByWorkspace: { w: 2 }, skillsSyncedTickBySession: { s: 1 } };
	expect(selectSkillsStale(stale, "w", "s")).toBe(true);
	// Synced at or past the last skill change → not stale.
	const synced = { skillChangeTickByWorkspace: { w: 2 }, skillsSyncedTickBySession: { s: 2 } };
	expect(selectSkillsStale(synced, "w", "s")).toBe(false);
	// A skill change with no recorded sync (→ 0) is stale; nothing recorded at all is not.
	expect(
		selectSkillsStale(
			{ skillChangeTickByWorkspace: { w: 1 }, skillsSyncedTickBySession: {} },
			"w",
			"s",
		),
	).toBe(true);
	expect(
		selectSkillsStale({ skillChangeTickByWorkspace: {}, skillsSyncedTickBySession: {} }, "w", "s"),
	).toBe(false);
});

// The shell swallows Ctrl+R app-wide, so "which chat did that mean" has to be answerable from store state
// alone — and must resolve to SOMETHING whenever the workspace has a chat at all, or the chord silently
// dies over a file/diff tab.
const chat1: EditorTab = {
	kind: "chat",
	id: "w2:s1",
	workspaceId: "w2",
	name: "One",
	sessionId: "s1",
};
const chat2: EditorTab = {
	kind: "chat",
	id: "w2:s2",
	workspaceId: "w2",
	name: "Two",
	sessionId: "s2",
};
const fileTab: EditorTab = {
	kind: "file",
	id: "w2:src/a.ts",
	workspaceId: "w2",
	name: "a.ts",
	path: "src/a.ts",
};

test("selectHistoryTarget prefers the active chat tab", () => {
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w2",
			tabsByWorkspace: { w2: [chat1, chat2, fileTab] },
			activeTabByWorkspace: { w2: "w2:s1" },
		}),
	).toEqual({ workspaceId: "w2", tabId: "w2:s1", sessionId: "s1" });
});

test("selectHistoryTarget falls back to the newest chat tab when a non-chat tab is active", () => {
	// The regression this guards: returning null here made Ctrl+R a silent no-op over Monaco/diffs —
	// exactly the tabs the app-wide swallow exists to cover. `chat2` is last in open order, so it wins.
	for (const activeTabId of ["w2:src/a.ts", null]) {
		expect(
			selectHistoryTarget({
				activeWorkspaceId: "w2",
				tabsByWorkspace: { w2: [chat1, chat2, fileTab] },
				activeTabByWorkspace: { w2: activeTabId },
			}),
		).toEqual({ workspaceId: "w2", tabId: "w2:s2", sessionId: "s2" });
	}
});

test("selectHistoryTarget is null only with no chat to open", () => {
	// No chat tab in the workspace at all.
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w2",
			tabsByWorkspace: { w2: [fileTab] },
			activeTabByWorkspace: { w2: "w2:src/a.ts" },
		}),
	).toBeNull();
	// No active workspace.
	expect(
		selectHistoryTarget({
			activeWorkspaceId: null,
			tabsByWorkspace: { w2: [chat1] },
			activeTabByWorkspace: { w2: "w2:s1" },
		}),
	).toBeNull();
	// Another workspace's chats are never reachable through the active one.
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w1",
			tabsByWorkspace: { w2: [chat1] },
			activeTabByWorkspace: { w1: "w2:s1" },
		}),
	).toBeNull();
});

test("matchesWorktreePath accepts the relative form and an absolute report, anchored at a separator", () => {
	expect(matchesWorktreePath("src/foo.ts", "src/foo.ts")).toBe(true);
	expect(matchesWorktreePath("/wt/src/foo.ts", "src/foo.ts")).toBe(true);
	expect(matchesWorktreePath("C:\\wt\\src/foo.ts", "src/foo.ts")).toBe(true);
	// Anchored: a sibling whose name merely ends with the entry must not match.
	expect(matchesWorktreePath("/wt/src/a-foo.ts", "src/foo.ts")).toBe(false);
	expect(matchesWorktreePath("src/other.ts", "src/foo.ts")).toBe(false);
	// A `./`-prefixed report is the same file (the old suffix rule absorbed the prefix by accident; the
	// anchored rule would drop it, so `normalizePath` strips it for every predicate).
	expect(matchesWorktreePath("./src/foo.ts", "src/foo.ts")).toBe(true);
});

test("matchesWorktreePath does not let a RELATIVE report match a shorter entry by suffix", () => {
	// The suffix rule exists to absorb an absolute report; letting it apply to relative ones made every
	// `<module>/SPEC.md` in a repo match the ROOT `SPEC.md` entry — one spec impersonating all of them.
	expect(matchesWorktreePath("module-b/SPEC.md", "SPEC.md")).toBe(false);
	expect(matchesWorktreePath("packages/server/SPEC.md", "SPEC.md")).toBe(false);
	// The absolute form of the same pair still resolves, since there the prefix IS the worktree root.
	expect(matchesWorktreePath("/wt/ws/SPEC.md", "SPEC.md")).toBe(true);
});

test("specPathMatcher recognizes a spec by graph membership, in either reported form", () => {
	const nodes = [
		{
			id: "task-x",
			type: "task-spec",
			title: "X",
			path: ".thinkrail/context/TASK-x.md",
			dependsOn: [],
			references: [],
			implements: [],
			tags: [],
		},
	];
	const isSpec = specPathMatcher(nodes);

	expect(isSpec(".thinkrail/context/TASK-x.md")).toBe(true);
	expect(isSpec("/wt/ws/.thinkrail/context/TASK-x.md")).toBe(true);
	expect(isSpec("packages/server/src/todos/todos.ts")).toBe(false);
	// An empty graph (never fetched) classifies nothing as a spec — the single-chip fallback.
	expect(specPathMatcher([])(".thinkrail/context/TASK-x.md")).toBe(false);
});
