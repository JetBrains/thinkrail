import { expect, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";
import {
	isSkillPath,
	selectActiveWorkspace,
	selectActiveWorkspaceProjectId,
	selectContextProject,
	selectSkillsStale,
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
