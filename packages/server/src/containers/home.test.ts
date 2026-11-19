import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@thinkrail/contracts";
import { setTrashImplementationForTests } from "../trash";
import {
	addContainerWorkspace,
	createContainer,
	forgetContainerMember,
	removeContainer,
	removeContainerWorkspace,
	syncContainerMemberLinks,
} from ".";
import { containerHome, linkName, memberLinks } from "./home";

let root: string;
let trashed: string[];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const symlinks = process.platform !== "win32";

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

let workspaces: Workspace[] = [];

function writeWorkspaces(next: Workspace[]): void {
	workspaces = next;
	for (const ws of next) {
		mkdirSync(ws.worktreePath, { recursive: true });
		writeFileSync(join(ws.worktreePath, "README.md"), `# ${ws.id}\n`);
	}
	writeFileSync(join(root, "workspaces.json"), JSON.stringify(next));
}

const linksOf = (id: string) => join(containerHome(id), "workspaces");

function links(id: string): Record<string, string> {
	const dir = linksOf(id);
	return Object.fromEntries(
		readdirSync(dir)
			.filter((name) => lstatSync(join(dir, name)).isSymbolicLink())
			.map((name) => [name, readlinkSync(join(dir, name))]),
	);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-container-home-"));
	process.env.THINKRAIL_DATA_DIR = root;
	writeFileSync(join(root, "projects.json"), JSON.stringify(projects));
	writeWorkspaces([
		workspace("w1", { branch: "openspec-board" }),
		workspace("w2", { branch: "openspec-archive" }),
		workspace("w3", { projectId: "p2", branch: "feat/docs" }),
	]);
	trashed = [];
	setTrashImplementationForTests(async (input) => {
		for (const path of typeof input === "string" ? [input] : input) {
			trashed.push(path);
			rmSync(path, { recursive: true, force: true });
		}
	});
});

afterEach(() => {
	setTrashImplementationForTests(undefined);
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("link names are one safe path segment, unique by member order", () => {
	expect(linkName("thinkrail", "feat/x")).toBe("thinkrail-feat-x");
	expect(linkName("web", "../../etc")).toBe("web-.-.-etc");
	expect(linkName("", "..")).toBe("workspace");
	expect(linkName("", "CON")).toBe("CON-workspace");
	expect(linkName("a", "b".repeat(300))).toHaveLength(100);
	const container = {
		id: "c1",
		name: "c",
		workspaceIds: ["w1", "w2", "w3"],
		createdAt: 1,
		updatedAt: 1,
	};
	const twins = [
		workspace("w1", { branch: "HEAD" }),
		workspace("w2", { branch: "head" }),
		workspace("w3", { branch: "HEAD" }),
	];
	expect([
		...memberLinks(container, twins, projects, new Set(["thinkrail-head-2"])).keys(),
	]).toEqual(["thinkrail-HEAD", "thinkrail-head-3", "thinkrail-HEAD-4"]);
});

test("a container id never names a folder outside the containers root", () => {
	for (const id of ["..", "../escape", "a/b", ""]) expect(() => containerHome(id)).toThrow();
});

test.if(symlinks)(
	"a new container's home holds ignored shared artifacts and one link per member",
	() => {
		const container = createContainer({ workspaceIds: ["w1", "w3"] });
		const home = containerHome(container.id);
		expect(readFileSync(join(home, ".thinkrail", "context", ".gitignore"), "utf8")).toBe("*\n");
		expect(links(container.id)).toEqual({
			"thinkrail-openspec-board": join(root, "worktrees", "w1"),
			"website-feat-docs": join(root, "worktrees", "w3"),
		});
		expect(
			readFileSync(join(linksOf(container.id), "website-feat-docs", "README.md"), "utf8"),
		).toBe("# w3\n");
	},
);

test.if(symlinks)("links follow members joining, leaving and changing branch", async () => {
	const container = createContainer({ workspaceIds: ["w1"] });
	addContainerWorkspace(container.id, "w2");
	expect(Object.keys(links(container.id))).toEqual([
		"thinkrail-openspec-archive",
		"thinkrail-openspec-board",
	]);
	await removeContainerWorkspace(container.id, "w1");
	expect(Object.keys(links(container.id))).toEqual(["thinkrail-openspec-archive"]);
	writeWorkspaces(
		workspaces.map((ws) => (ws.id === "w2" ? { ...ws, branch: "openspec-renamed" } : ws)),
	);
	syncContainerMemberLinks("w2");
	expect(links(container.id)).toEqual({
		"thinkrail-openspec-renamed": join(root, "worktrees", "w2"),
	});
	expect(existsSync(join(root, "worktrees", "w1", "README.md"))).toBe(true);
});

test.if(symlinks)("an entry that is not a link is kept and its name is not reused", () => {
	const container = createContainer({ workspaceIds: ["w1"] });
	const dir = linksOf(container.id);
	rmSync(join(dir, "thinkrail-openspec-board"));
	mkdirSync(join(dir, "thinkrail-openspec-board"));
	writeFileSync(join(dir, "thinkrail-openspec-board", "notes.md"), "mine\n");
	syncContainerMemberLinks("w1");
	expect(readFileSync(join(dir, "thinkrail-openspec-board", "notes.md"), "utf8")).toBe("mine\n");
	expect(links(container.id)).toEqual({
		"thinkrail-openspec-board-2": join(root, "worktrees", "w1"),
	});
});

test.if(symlinks)("a links folder swapped for a link is refused, never followed", () => {
	const container = createContainer({ workspaceIds: ["w1"] });
	const outside = join(root, "outside");
	mkdirSync(outside);
	symlinkSync(join(root, "worktrees", "w1"), join(outside, "stale-link"));
	rmSync(linksOf(container.id), { recursive: true });
	symlinkSync(outside, linksOf(container.id));
	addContainerWorkspace(container.id, "w2");
	expect(readdirSync(outside)).toEqual(["stale-link"]);
	expect(lstatSync(linksOf(container.id)).isSymbolicLink()).toBe(true);
});

test.if(symlinks)(
	"a stale link is unlinked, never followed into the worktree it named",
	async () => {
		const container = createContainer({ workspaceIds: ["w1", "w2"] });
		symlinkSync(join(root, "worktrees", "w2"), join(linksOf(container.id), "left-over"));
		await removeContainerWorkspace(container.id, "w2");
		expect(Object.keys(links(container.id))).toEqual(["thinkrail-openspec-board"]);
		expect(readFileSync(join(root, "worktrees", "w2", "README.md"), "utf8")).toBe("# w2\n");
	},
);

test.if(symlinks)(
	"dissolving an untouched home removes its scaffold without the trash",
	async () => {
		const container = createContainer({ workspaceIds: ["w1", "w3"] });
		await removeContainer(container.id);
		expect(existsSync(containerHome(container.id))).toBe(false);
		expect(trashed).toEqual([]);
		expect(readFileSync(join(root, "worktrees", "w1", "README.md"), "utf8")).toBe("# w1\n");
		expect(readFileSync(join(root, "worktrees", "w3", "README.md"), "utf8")).toBe("# w3\n");
	},
);

test.if(symlinks)(
	"a .thinkrail swapped for a link is left whole, never emptied through the link",
	async () => {
		const container = createContainer({ workspaceIds: ["w1"] });
		const home = containerHome(container.id);
		const outside = join(root, "outside");
		mkdirSync(join(outside, "context"), { recursive: true });
		writeFileSync(join(outside, "context", ".gitignore"), "*\n");
		rmSync(join(home, ".thinkrail"), { recursive: true });
		symlinkSync(outside, join(home, ".thinkrail"));
		await removeContainer(container.id);
		expect(trashed).toEqual([home]);
		expect(readFileSync(join(outside, "context", ".gitignore"), "utf8")).toBe("*\n");
	},
);

test.if(symlinks)("shared artifacts go to the trash with the home, without its links", async () => {
	const container = createContainer({ workspaceIds: ["w1"] });
	const home = containerHome(container.id);
	writeFileSync(join(home, ".thinkrail", "context", "research.md"), "# findings\n");
	let linksAtTrash: string[] = [];
	setTrashImplementationForTests(async (input) => {
		const path = String(input);
		linksAtTrash = existsSync(join(path, "workspaces"))
			? readdirSync(join(path, "workspaces"))
			: [];
		trashed.push(path);
		rmSync(path, { recursive: true, force: true });
	});
	await forgetContainerMember("w1");
	expect(trashed).toEqual([home]);
	expect(linksAtTrash).toEqual([]);
	expect(readFileSync(join(root, "worktrees", "w1", "README.md"), "utf8")).toBe("# w1\n");
});
