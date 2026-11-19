import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Container, Project, Workspace } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { type ContainerEvent, setContainerPublisher } from "../containers";
import { setTrashImplementationForTests } from "../trash";
import { stopAllWatches } from "../watch";
import { setWorkspacePublisher } from "../workspaces";
import { observeWorkspaceForContainers } from "./containers";
import { handleRequest } from "./handlers";
import { settleOrchestratorStartsForTests } from "./orchestrator";

const CTX = { clientKey: "containers-test" };

let root: string;
let events: ContainerEvent[];
const saved = { data: process.env.THINKRAIL_DATA_DIR, agent: process.env.PI_CODING_AGENT_DIR };

const projects: Project[] = [
	{ id: "p1", name: "ThinkRail", path: "/repos/thinkrail", slug: "thinkrail", lastOpened: 1 },
	{ id: "p2", name: "Website", path: "/repos/website", slug: "website", lastOpened: 1 },
];

function workspace(id: string, over: Partial<Workspace> = {}): Workspace {
	return {
		id,
		projectId: "p1",
		kind: "external",
		name: `Workspace ${id}`,
		branch: id,
		worktreePath: join(root, "worktrees", id),
		baseBranch: "main",
		renamed: true,
		...over,
	};
}

function writeWorkspaces(workspaces: Workspace[]): void {
	for (const ws of workspaces) mkdirSync(ws.worktreePath, { recursive: true });
	writeFileSync(join(root, "workspaces.json"), JSON.stringify(workspaces));
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error) {
		return errorCodeOf(error) ?? (error as Error).message;
	}
	return "no error";
}

const request = <T>(method: string, params: unknown) =>
	handleRequest(method, params, CTX) as Promise<T>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-host-containers-"));
	process.env.THINKRAIL_DATA_DIR = root;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	writeFileSync(join(root, "projects.json"), JSON.stringify(projects));
	writeWorkspaces([
		workspace("w1"),
		workspace("w2", { projectId: "p2" }),
		workspace("w3"),
		workspace("def", { kind: "default", name: "Default", worktreePath: join(root, "repo") }),
	]);
	events = [];
	setContainerPublisher((event) => events.push(event));
	setWorkspacePublisher(observeWorkspaceForContainers);
	setTrashImplementationForTests(async (input) => {
		for (const path of typeof input === "string" ? [input] : input) {
			rmSync(path, { recursive: true, force: true });
		}
	});
});

afterEach(async () => {
	await Bun.sleep(20);
	await settleOrchestratorStartsForTests();
	stopAllWatches();
	setWorkspacePublisher(null);
	setContainerPublisher(null);
	setTrashImplementationForTests(undefined);
	rmSync(root, { recursive: true, force: true });
	for (const [key, value] of [
		["THINKRAIL_DATA_DIR", saved.data],
		["PI_CODING_AGENT_DIR", saved.agent],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("the container methods create, list, rename, regroup and dissolve one record", async () => {
	const created = await request<Container>("container.create", {
		name: "Docs everywhere",
		workspaceIds: ["w1", "w2"],
	});
	expect(created).toMatchObject({ name: "Docs everywhere", workspaceIds: ["w1", "w2"] });
	expect(await request<Container[]>("container.list", {})).toEqual([created]);

	const renamed = await request<Container>("container.rename", {
		containerId: created.id,
		name: "Docs",
	});
	expect(renamed.name).toBe("Docs");
	expect(
		await request<Container>("container.addWorkspace", {
			containerId: created.id,
			workspaceId: "w3",
		}),
	).toMatchObject({ workspaceIds: ["w1", "w2", "w3"] });
	expect(
		await request<Container | null>("container.removeWorkspace", {
			containerId: created.id,
			workspaceId: "w1",
		}),
	).toMatchObject({ workspaceIds: ["w2", "w3"] });
	expect(await request("container.remove", { containerId: created.id })).toEqual({ ok: true });
	expect(await request<Container[]>("container.list", {})).toEqual([]);
	expect(events.map((event) => event.kind)).toEqual([
		"updated",
		"updated",
		"updated",
		"updated",
		"removed",
	]);
	expect(JSON.parse(await Bun.file(join(root, "workspaces.json")).text())).toHaveLength(4);
});

test("the container methods refuse with their codes", async () => {
	const { id } = await request<Container>("container.create", { workspaceIds: ["w1"] });
	expect(await refusal(() => request("container.create", { workspaceIds: [] }))).toBe(
		"CONTAINER_EMPTY",
	);
	expect(await refusal(() => request("container.create", { workspaceIds: ["w1"] }))).toBe(
		"CONTAINER_MEMBER_TAKEN",
	);
	expect(
		await refusal(() => request("container.addWorkspace", { containerId: id, workspaceId: "def" })),
	).toBe("CONTAINER_MEMBER_REFUSED");
	expect(
		await refusal(() => request("container.rename", { containerId: "missing", name: "x" })),
	).toBe("CONTAINER_UNKNOWN");
	expect(
		await refusal(() =>
			request("container.removeWorkspace", { containerId: "missing", workspaceId: "w1" }),
		),
	).toBe("CONTAINER_UNKNOWN");
});

test("archiving members makes them leave, and the container goes with its last member", async () => {
	const container = await request<Container>("container.create", { workspaceIds: ["w1", "w2"] });
	const home = join(root, "containers", container.id);
	expect(readdirSync(join(home, "workspaces")).sort()).toEqual(["thinkrail-w1", "website-w2"]);

	expect(await request("workspace.remove", { id: "w1" })).toEqual({ ok: true });
	expect(await request<Container[]>("container.list", {})).toMatchObject([
		{ id: container.id, workspaceIds: ["w2"] },
	]);
	expect(readdirSync(join(home, "workspaces"))).toEqual(["website-w2"]);

	await request("workspace.remove", { id: "w2" });
	await Bun.sleep(20);
	expect(await request<Container[]>("container.list", {})).toEqual([]);
	expect(events.at(-1)).toEqual({ kind: "removed", id: container.id });
	expect(existsSync(home)).toBe(false);
	expect(existsSync(join(root, "worktrees", "w2"))).toBe(true);
});

test("a member's branch change relinks its container's home", async () => {
	const container = await request<Container>("container.create", { workspaceIds: ["w1"] });
	const moved = workspace("w1", { branch: "feat/renamed" });
	writeWorkspaces([moved, workspace("w2", { projectId: "p2" })]);
	observeWorkspaceForContainers({ kind: "updated", workspace: moved });
	const links = join(root, "containers", container.id, "workspaces");
	expect(readdirSync(links)).toEqual(["thinkrail-feat-renamed"]);
	expect(lstatSync(join(links, "thinkrail-feat-renamed")).isSymbolicLink()).toBe(true);
});
