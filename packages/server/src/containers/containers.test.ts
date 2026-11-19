import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { saveContainers } from "../persistence";
import { setTrashImplementationForTests } from "../trash";
import {
	addContainerWorkspace,
	type ContainerEvent,
	createContainer,
	forgetContainerMember,
	listContainers,
	removeContainer,
	removeContainerWorkspace,
	renameContainer,
	setContainerPublisher,
} from ".";

let root: string;
let events: ContainerEvent[];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

const projects: Project[] = [
	{ id: "p1", name: "ThinkRail", path: "/repos/thinkrail", slug: "thinkrail", lastOpened: 1 },
	{ id: "p2", name: "Website", path: "/repos/website", slug: "website", lastOpened: 1 },
];

function workspace(id: string, over: Partial<Workspace> = {}): Workspace {
	return {
		id,
		projectId: "p1",
		name: `Workspace ${id}`,
		branch: id,
		worktreePath: join(root, "worktrees", id),
		baseBranch: "main",
		...over,
	};
}

function writeWorkspaces(workspaces: Workspace[]): void {
	for (const ws of workspaces) mkdirSync(ws.worktreePath, { recursive: true });
	writeFileSync(join(root, "workspaces.json"), JSON.stringify(workspaces));
}

function codeOf(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return errorCodeOf(error) ?? (error as Error).message;
	}
	return "no error";
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-containers-"));
	process.env.THINKRAIL_DATA_DIR = root;
	writeFileSync(join(root, "projects.json"), JSON.stringify(projects));
	writeWorkspaces([
		workspace("w1"),
		workspace("w2"),
		workspace("w3", { projectId: "p2" }),
		workspace("ext", { kind: "external", branch: "feature" }),
		workspace("def", { kind: "default", name: "Default" }),
	]);
	events = [];
	setContainerPublisher((event) => events.push(event));
	setTrashImplementationForTests(async () => {
		throw new Error("nothing should be trashed here");
	});
});

afterEach(() => {
	setContainerPublisher(null);
	setTrashImplementationForTests(undefined);
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("a container groups managed and attached worktrees of several projects, persisted and published", () => {
	const container = createContainer({
		name: "  OpenSpec   support ",
		workspaceIds: ["w1", "w3", "ext"],
	});
	expect(container).toMatchObject({ name: "OpenSpec support", workspaceIds: ["w1", "w3", "ext"] });
	expect(container.createdAt).toBe(container.updatedAt);
	expect(listContainers()).toEqual([container]);
	expect(JSON.parse(readFileSync(join(root, "containers.json"), "utf8")).containers).toEqual([
		container,
	]);
	expect(events).toEqual([{ kind: "updated", container }]);
});

test("an unnamed container takes its first member's name, and a create without members is refused", () => {
	expect(createContainer({ workspaceIds: ["w2", "w2"] })).toMatchObject({
		name: "Workspace w2",
		workspaceIds: ["w2"],
	});
	expect(codeOf(() => createContainer({ name: "Empty", workspaceIds: [] }))).toBe(
		"CONTAINER_EMPTY",
	);
	expect(listContainers()).toHaveLength(1);
});

test("a workspace belongs to at most one container", () => {
	const first = createContainer({ workspaceIds: ["w1"] });
	const second = createContainer({ workspaceIds: ["w2"] });
	expect(codeOf(() => createContainer({ workspaceIds: ["w3", "w1"] }))).toBe(
		"CONTAINER_MEMBER_TAKEN",
	);
	expect(codeOf(() => addContainerWorkspace(second.id, "w1"))).toBe("CONTAINER_MEMBER_TAKEN");
	expect(addContainerWorkspace(first.id, "w1").workspaceIds).toEqual(["w1"]);
	expect(listContainers().map((container) => container.workspaceIds)).toEqual([["w1"], ["w2"]]);
});

test("the Default workspace and chats without a project never join, and unknown ids are refused", () => {
	const container = createContainer({ workspaceIds: ["w1"] });
	writeWorkspaces([
		workspace("w1"),
		workspace("def", { kind: "default", name: "Default" }),
		workspace("chat", { kind: "chat", projectId: "chats", branch: "", baseBranch: "" }),
	]);
	expect(codeOf(() => addContainerWorkspace(container.id, "def"))).toBe("CONTAINER_MEMBER_REFUSED");
	expect(codeOf(() => addContainerWorkspace(container.id, "chat"))).toBe(
		"CONTAINER_MEMBER_REFUSED",
	);
	expect(codeOf(() => createContainer({ workspaceIds: ["def"] }))).toBe("CONTAINER_MEMBER_REFUSED");
	expect(codeOf(() => addContainerWorkspace(container.id, "missing"))).toBe(
		"Unknown workspace: missing",
	);
	expect(codeOf(() => addContainerWorkspace("nope", "w1"))).toBe("CONTAINER_UNKNOWN");
	expect(codeOf(() => renameContainer("nope", "x"))).toBe("CONTAINER_UNKNOWN");
	expect(listContainers()[0]?.workspaceIds).toEqual(["w1"]);
});

test("rename and add change the record and its updatedAt; a blank name is refused", async () => {
	const container = createContainer({ workspaceIds: ["w1"] });
	await Bun.sleep(2);
	const renamed = renameContainer(container.id, "Stack");
	expect(renamed.name).toBe("Stack");
	expect(renamed.updatedAt).toBeGreaterThan(container.updatedAt);
	expect(codeOf(() => renameContainer(container.id, "   "))).toBe(
		"A container name cannot be empty",
	);
	expect(addContainerWorkspace(container.id, "w3").workspaceIds).toEqual(["w1", "w3"]);
	expect(events.map((event) => event.kind)).toEqual(["updated", "updated", "updated"]);
});

test("removing a member leaves it standalone; removing the last one dissolves the container", async () => {
	const container = createContainer({ workspaceIds: ["w1", "w2"] });
	expect(await removeContainerWorkspace(container.id, "w1")).toMatchObject({
		workspaceIds: ["w2"],
	});
	expect(await removeContainerWorkspace(container.id, "w3")).toMatchObject({
		workspaceIds: ["w2"],
	});
	expect(await removeContainerWorkspace(container.id, "w2")).toBeNull();
	expect(listContainers()).toEqual([]);
	expect(events.at(-1)).toEqual({ kind: "removed", id: container.id });
	expect(createContainer({ workspaceIds: ["w1", "w2"] }).workspaceIds).toEqual(["w1", "w2"]);
});

test("dissolving a container removes only the record and is idempotent", async () => {
	const container = createContainer({ workspaceIds: ["w1", "w2"] });
	await removeContainer(container.id);
	await removeContainer(container.id);
	expect(listContainers()).toEqual([]);
	expect(events.filter((event) => event.kind === "removed")).toEqual([
		{ kind: "removed", id: container.id },
	]);
	expect(JSON.parse(readFileSync(join(root, "workspaces.json"), "utf8"))).toHaveLength(5);
});

test("an archived workspace leaves its container, and the container goes once it is empty", async () => {
	const kept = createContainer({ workspaceIds: ["w1", "w2"] });
	const single = createContainer({ workspaceIds: ["w3"] });
	await forgetContainerMember("w1");
	await forgetContainerMember("ext");
	expect(listContainers()).toMatchObject([
		{ id: kept.id, workspaceIds: ["w2"] },
		{ id: single.id },
	]);
	await forgetContainerMember("w3");
	expect(listContainers().map((container) => container.id)).toEqual([kept.id]);
	expect(events.slice(2)).toEqual([
		{ kind: "updated", container: expect.objectContaining({ workspaceIds: ["w2"] }) },
		{ kind: "removed", id: single.id },
	]);
});

test("a store a newer host wrote refuses every change and stays as it was", async () => {
	const newer = JSON.stringify({ version: 2, containers: [] });
	writeFileSync(join(root, "containers.json"), newer);
	expect(listContainers()).toEqual([]);
	expect(codeOf(() => createContainer({ workspaceIds: ["w1"] }))).toBe(
		"CONTAINERS_STORE_UNAVAILABLE",
	);
	await expect(removeContainer("c1")).rejects.toMatchObject({
		code: "CONTAINERS_STORE_UNAVAILABLE",
	});
	await forgetContainerMember("w1");
	expect(readFileSync(join(root, "containers.json"), "utf8")).toBe(newer);
});

test("records written earlier are read back as stored", () => {
	saveContainers([
		{
			id: "c1",
			name: "Kept",
			workspaceIds: ["w1"],
			orchestratorSessionId: "s1",
			createdAt: 1,
			updatedAt: 1,
		},
	]);
	expect(addContainerWorkspace("c1", "w2")).toMatchObject({
		id: "c1",
		orchestratorSessionId: "s1",
		workspaceIds: ["w1", "w2"],
	});
});
