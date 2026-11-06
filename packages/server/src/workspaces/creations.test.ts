import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { WorkspaceCreation, WorkspaceCreationRemoved } from "@thinkrail/contracts";
import {
	createProject,
	initProject,
	inspectCloneDestination,
	openProject,
	setProjectPathGuard,
} from "../projects";
import {
	creationOwnsPath,
	setWorkspaceCreationPublisher,
	type WorkspaceCreationEvent,
} from "./creationRecords";
import {
	awaitWorkspaceCreation,
	checkoutFailureText,
	createWorkspace,
	dismissWorkspaceCreation,
	interruptWorkspaceCreations,
	listWorkspaceCreations,
	replayPendingHandoffs,
	retryWorkspaceCreation,
	setCheckoutStallForTests,
	setWorkspaceCreationHandoff,
	startWorkspaceCreation,
	stopWorkspaceCreations,
} from "./creations";
import {
	listExistingWorktrees,
	listWorkspaceRecords,
	openExistingWorktree,
	renameWorkspace,
} from "./workspaces";

const posix = test.skipIf(process.platform === "win32");

let dataDir: string;
let repo: string;
let events: WorkspaceCreationEvent[];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function gitOut(cwd: string, ...args: string[]): string {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	return new TextDecoder().decode(r.stdout).trim();
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function registered(): string[] {
	return gitOut(repo, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => resolve(line.slice("worktree ".length)));
}

function hook(body: string): void {
	const path = join(repo, ".git", "hooks", "post-checkout");
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
}

function removed(): WorkspaceCreationRemoved[] {
	return events.flatMap((event) => (event.kind === "removed" ? [event.removed] : []));
}

function changed(): WorkspaceCreation[] {
	return events.flatMap((event) => (event.kind === "changed" ? [event.creation] : []));
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > ms) throw new Error("condition not reached");
		await Bun.sleep(20);
	}
}

beforeEach(() => {
	dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-create-test-")));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	writeFileSync(join(repo, "a.txt"), "a\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	events = [];
	setWorkspaceCreationPublisher((event) => events.push(event));
});

afterEach(async () => {
	await stopWorkspaceCreations();
	setWorkspaceCreationPublisher(null);
	setWorkspaceCreationHandoff(null);
	setCheckoutStallForTests(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

posix("a slow checkout never blocks the host's event loop (#874)", async () => {
	hook("sleep 1");
	let tick = -1;
	const started = performance.now();
	setTimeout(() => {
		tick = performance.now() - started;
	}, 50);
	const creation = startWorkspaceCreation("p1");
	expect(performance.now() - started).toBeLessThan(500);
	expect(creation).toMatchObject({ state: "running", phase: "preparing", branch: "workspace-1" });

	const workspace = await awaitWorkspaceCreation(creation.id);
	expect(tick).toBeGreaterThan(0);
	expect(tick).toBeLessThan(500);
	expect(workspace.id).toBe(creation.id);
	expect(existsSync(join(workspace.worktreePath, "a.txt"))).toBe(true);
	expect(gitOut(workspace.worktreePath, "status", "--porcelain")).toBe("");
	expect(listWorkspaceCreations()).toEqual([]);
	expect(removed()).toEqual([{ id: creation.id, projectId: "p1", workspace }]);
});

posix(
	"real git checkout progress reaches clients and the handoff starts the held chat",
	async () => {
		for (let i = 0; i < 40; i++) writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
		git(repo, "add", "-A");
		git(repo, "commit", "-m", "files");
		const savedDelay = process.env.GIT_PROGRESS_DELAY;
		process.env.GIT_PROGRESS_DELAY = "0";
		const handed: unknown[] = [];
		setWorkspaceCreationHandoff(async (workspace, kickoff) => {
			handed.push({ id: workspace.id, kickoff });
			return { sessionId: "s-1" };
		});
		try {
			const kickoff = { text: "Fix the login flow", images: [] };
			const creation = startWorkspaceCreation("p1", { name: "Login fix", kickoff });
			expect(creation.kickoff).toEqual({ text: "Fix the login flow", imageCount: 0 });
			expect(creation.name).toBe("Login fix");

			const workspace = await awaitWorkspaceCreation(creation.id);
			const last = changed().findLast((c) => c.progress);
			expect(last?.progress?.total).toBe(42);
			expect(changed().some((c) => c.phase === "checking-out")).toBe(true);
			expect(handed).toEqual([{ id: creation.id, kickoff }]);
			expect(removed().at(-1)).toMatchObject({ id: creation.id, sessionId: "s-1" });
			expect(workspace).toMatchObject({ name: "Login fix", renamed: true, branch: "login-fix" });
		} finally {
			if (savedDelay === undefined) delete process.env.GIT_PROGRESS_DELAY;
			else process.env.GIT_PROGRESS_DELAY = savedDelay;
		}
	},
);

posix(
	"post-checkout sees a new worktree (null old oid) exactly once, as plain worktree add reports it",
	async () => {
		const args = join(dataDir, "hook-args");
		hook(`echo "$*" >> "${args}"`);
		const creation = startWorkspaceCreation("p1");
		await awaitWorkspaceCreation(creation.id);
		const head = gitOut(repo, "rev-parse", "main");
		expect(readFileSync(args, "utf8")).toBe(`${"0".repeat(head.length)} ${head} 1\n`);
	},
);

posix("a failing post-checkout hook fails the create like worktree add and cleans up", async () => {
	hook("echo hook says no >&2; exit 1");
	const creation = startWorkspaceCreation("p1");
	await expect(awaitWorkspaceCreation(creation.id)).rejects.toThrow(
		"The post-checkout hook failed: hook says no",
	);
	expect(listWorkspaceCreations()[0]?.failure).toMatchObject({
		code: "WORKTREE_CHECKOUT_FAILED",
		cleanedUp: true,
	});
	expect(registered()).toEqual([realpathSync.native(repo)]);
	expect(gitOut(repo, "branch", "--list", "workspace-1")).toBe("");
});

posix("a git without `git hook run` still fires post-checkout directly", async () => {
	const args = join(dataDir, "hook-args");
	hook(`echo "$*" >> "${args}"`);
	const bin = join(dataDir, "old-git-bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "git"),
		`#!/bin/sh\nif [ "$3" = "hook" ]; then echo "git: 'hook' is not a git command. See 'git --help'." >&2; exit 1; fi\nexec "${Bun.which("git")}" "$@"\n`,
	);
	chmodSync(join(bin, "git"), 0o755);
	const savedPath = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
	try {
		await awaitWorkspaceCreation(startWorkspaceCreation("p1").id);
	} finally {
		process.env.PATH = savedPath;
	}
	const head = gitOut(repo, "rev-parse", "main");
	expect(readFileSync(args, "utf8")).toBe(`${"0".repeat(head.length)} ${head} 1\n`);
});

posix(
	"the last checkout progress reaches clients even when git exits inside the push throttle",
	async () => {
		const bin = join(dataDir, "fast-progress-git-bin");
		mkdirSync(bin);
		writeFileSync(
			join(bin, "git"),
			[
				"#!/bin/sh",
				'case " $* " in',
				'*" checkout --progress "*)',
				`\t"${Bun.which("git")}" "$@" 2>/dev/null || exit $?`,
				"\tprintf 'Updating files:  50%% (21/42)\\r' >&2",
				"\tsleep 0.1",
				"\tprintf 'Updating files: 100%% (42/42), done.\\n' >&2",
				"\texit 0;;",
				"esac",
				`exec "${Bun.which("git")}" "$@"`,
				"",
			].join("\n"),
		);
		chmodSync(join(bin, "git"), 0o755);
		const savedPath = process.env.PATH;
		process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
		try {
			await awaitWorkspaceCreation(startWorkspaceCreation("p1").id);
		} finally {
			process.env.PATH = savedPath;
		}
		expect(changed().findLast((c) => c.progress)?.progress).toEqual({ done: 42, total: 42 });
	},
);

posix("a repo with submodules and submodule.recurse creates like plain worktree add", async () => {
	const sub = join(dataDir, "sub");
	mkdirSync(sub);
	git(sub, "init", "-b", "main");
	git(sub, "config", "user.email", "t@thinkrail.test");
	git(sub, "config", "user.name", "test");
	git(sub, "commit", "--allow-empty", "-m", "s");
	git(repo, "-c", "protocol.file.allow=always", "submodule", "add", sub, "sub");
	git(repo, "commit", "-m", "sub");
	git(repo, "config", "submodule.recurse", "true");

	const workspace = await awaitWorkspaceCreation(startWorkspaceCreation("p1").id);
	expect(existsSync(join(workspace.worktreePath, "a.txt"))).toBe(true);
	expect(gitOut(workspace.worktreePath, "status", "--porcelain")).toBe("");
});

posix("a stalled checkout fails, cleans up, and keeps a retryable record", async () => {
	hook("sleep 3");
	setCheckoutStallForTests(300);
	const creation = startWorkspaceCreation("p1", { kickoff: { text: "do it" } });
	const message = await awaitWorkspaceCreation(creation.id).then(
		() => "",
		(err: Error) => err.message,
	);
	expect(message).toContain("made no progress");
	const [record] = listWorkspaceCreations();
	expect(record).toMatchObject({
		state: "failed",
		phase: "checking-out",
		failure: { code: "WORKTREE_CHECKOUT_STALLED", cleanedUp: true },
	});
	expect(registered()).toEqual([realpathSync.native(repo)]);
	expect(existsSync(join(dataDir, "worktrees", "repo", "workspace-1"))).toBe(false);
	expect(gitOut(repo, "branch", "--list", "workspace-1")).toBe("");

	setCheckoutStallForTests(undefined);
	hook("true");
	retryWorkspaceCreation(creation.id);
	const workspace = await awaitWorkspaceCreation(creation.id);
	expect(workspace.branch).toBe("workspace-1");
	expect(listWorkspaceCreations()).toEqual([]);
});

posix("a failing checkout reports git's error and dismiss hands the kickoff back", async () => {
	writeFileSync(join(repo, ".gitattributes"), "a.txt filter=boom\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "attrs");
	git(repo, "config", "filter.boom.smudge", "echo smudge exploded >&2; exit 1");
	git(repo, "config", "filter.boom.required", "true");
	const kickoff = { text: "keep me" };
	const creation = startWorkspaceCreation("p1", { kickoff });
	const message = await awaitWorkspaceCreation(creation.id).then(
		() => "",
		(err: Error) => err.message,
	);
	expect(message).toStartWith("git checkout failed:");
	expect(message).toContain("smudge exploded");
	expect(message).not.toContain("Updating files");
	expect(listWorkspaceCreations()[0]?.failure?.code).toBe("WORKTREE_CHECKOUT_FAILED");
	expect(gitOut(repo, "branch", "--list", "workspace-1")).toBe("");

	expect(await dismissWorkspaceCreation(creation.id)).toEqual({ kickoff });
	expect(listWorkspaceCreations()).toEqual([]);
	expect(removed().at(-1)).toEqual({ id: creation.id, projectId: "p1" });
});

posix("a checkout cut short by shutdown comes back interrupted and retries cleanly", async () => {
	hook("sleep 5");
	const creation = startWorkspaceCreation("p1");
	await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
	await stopWorkspaceCreations();
	interruptWorkspaceCreations();
	expect(listWorkspaceCreations()[0]).toMatchObject({
		state: "interrupted",
		phase: "checking-out",
	});

	hook("true");
	retryWorkspaceCreation(creation.id);
	const workspace = await awaitWorkspaceCreation(creation.id);
	expect(existsSync(join(workspace.worktreePath, "README.md"))).toBe(true);
	expect(gitOut(workspace.worktreePath, "status", "--porcelain")).toBe("");
	expect(gitOut(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("workspace-1");
});

posix("a folder that is still being created cannot be opened as a project", async () => {
	hook("sleep 1");
	const creation = startWorkspaceCreation("p1");
	const path = join(dataDir, "worktrees", "repo", "workspace-1");
	expect(creationOwnsPath(path)).toBe(true);
	expect(creationOwnsPath(join(path, "nested"))).toBe(true);
	expect(creationOwnsPath(repo)).toBe(false);
	await awaitWorkspaceCreation(creation.id);
	expect(creationOwnsPath(path)).toBe(false);
});

posix(
	"retrying an interrupted creation whose folder was opened since never touches it",
	async () => {
		hook("sleep 5");
		const creation = startWorkspaceCreation("p1");
		await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
		await stopWorkspaceCreations();
		interruptWorkspaceCreations();
		const path = join(dataDir, "worktrees", "repo", "workspace-1");
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([
				{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 },
				{ id: "p2", name: "taken", path, slug: "taken", lastOpened: 2 },
			]),
		);
		retryWorkspaceCreation(creation.id);
		await expect(awaitWorkspaceCreation(creation.id)).rejects.toThrow("already open in ThinkRail");
		const [record] = listWorkspaceCreations();
		expect(record?.failure?.code).toBe("WORKSPACE_PATH_TAKEN");
		expect(record?.failure?.cleanedUp).toBeUndefined();
		expect(existsSync(path)).toBe(true);
		expect(gitOut(repo, "branch", "--list", "workspace-1")).toContain("workspace-1");
	},
);

posix("discarding an interrupted creation removes its folder and branch", async () => {
	hook("sleep 5");
	const creation = startWorkspaceCreation("p1");
	await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
	await stopWorkspaceCreations();
	interruptWorkspaceCreations();

	await dismissWorkspaceCreation(creation.id);
	expect(registered()).toEqual([realpathSync.native(repo)]);
	expect(existsSync(join(dataDir, "worktrees", "repo", "workspace-1"))).toBe(false);
	expect(gitOut(repo, "branch", "--list", "workspace-1")).toBe("");
});

posix("in-flight creates reserve names and stay out of the existing-worktree doors", async () => {
	hook("sleep 1");
	const first = startWorkspaceCreation("p1");
	const second = startWorkspaceCreation("p1");
	expect(first.branch).toBe("workspace-1");
	expect(second.branch).toBe("workspace-2");

	await until(() => listWorkspaceCreations().every((c) => c.phase === "checking-out"));
	expect(await listExistingWorktrees("p1")).toEqual([]);
	const path = join(dataDir, "worktrees", "repo", "workspace-1");
	await expect(openExistingWorktree("p1", path)).rejects.toThrow("still being created");

	await Promise.all([awaitWorkspaceCreation(first.id), awaitWorkspaceCreation(second.id)]);
	expect(
		listWorkspaceRecords("p1")
			.map((w) => w.branch)
			.sort(),
	).toEqual(["workspace-1", "workspace-2"]);
});

posix("renaming the base branch mid-create repoints the pending base", async () => {
	const base = await createWorkspace("p1");
	hook("sleep 1");
	const creation = startWorkspaceCreation("p1", { baseRef: base.branch });
	await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
	renameWorkspace(base.id, "Renamed", { branch: "renamed-base" });
	expect(listWorkspaceCreations()[0]?.baseBranch).toBe("renamed-base");

	const workspace = await awaitWorkspaceCreation(creation.id);
	expect(workspace.baseBranch).toBe("renamed-base");
});

posix(
	"a folder opened elsewhere mid-create is left alone and cannot be retried as-is",
	async () => {
		hook("sleep 1");
		const creation = startWorkspaceCreation("p1");
		await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
		const path = join(dataDir, "worktrees", "repo", "workspace-1");
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([
				{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 },
				{ id: "p2", name: "taken", path, slug: "taken", lastOpened: 2 },
			]),
		);
		await expect(awaitWorkspaceCreation(creation.id)).rejects.toThrow("already open in ThinkRail");
		expect(listWorkspaceCreations()[0]?.failure?.code).toBe("WORKSPACE_PATH_TAKEN");
		expect(existsSync(join(path, "README.md"))).toBe(true);
		expect(() => retryWorkspaceCreation(creation.id)).toThrow("Edit & retry");

		await dismissWorkspaceCreation(creation.id);
		expect(existsSync(join(path, "README.md"))).toBe(true);
		expect(listWorkspaceCreations()).toEqual([]);
	},
);

posix("dismissing an interrupted creation never touches a folder opened since", async () => {
	hook("sleep 5");
	const creation = startWorkspaceCreation("p1");
	await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
	await stopWorkspaceCreations();
	interruptWorkspaceCreations();
	const path = join(dataDir, "worktrees", "repo", "workspace-1");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 },
			{ id: "p2", name: "taken", path, slug: "taken", lastOpened: 2 },
		]),
	);

	const dismissing = dismissWorkspaceCreation(creation.id);
	expect(() => retryWorkspaceCreation(creation.id)).toThrow("being dismissed");
	await expect(dismissWorkspaceCreation(creation.id)).rejects.toThrow("already being dismissed");
	await dismissing;
	expect(existsSync(path)).toBe(true);
	expect(gitOut(repo, "branch", "--list", "workspace-1")).toContain("workspace-1");
	expect(listWorkspaceCreations()).toEqual([]);
});

posix("a create that fails before anything exists never claims a cleanup", async () => {
	const creation = startWorkspaceCreation("p1", { baseRef: "no-such-branch" });
	await expect(awaitWorkspaceCreation(creation.id)).rejects.toThrow("Could not resolve");
	const [record] = listWorkspaceCreations();
	expect(record?.failure?.code).toBe("WORKTREE_ADD_FAILED");
	expect(record?.failure?.cleanedUp).toBeUndefined();
});

posix(
	"a host that died mid-handoff replays it at start instead of dropping the held prompt",
	async () => {
		const workspace = await createWorkspace("p1");
		const file = join(dataDir, "workspace-creations.json");
		writeFileSync(
			file,
			JSON.stringify([
				{
					id: workspace.id,
					projectId: "p1",
					name: workspace.name,
					branch: workspace.branch,
					worktreePath: workspace.worktreePath,
					baseBranch: workspace.baseBranch,
					state: "running",
					phase: "checking-out",
					startedAt: 1,
					kickoff: { text: "still here" },
				},
			]),
		);
		interruptWorkspaceCreations();
		expect(listWorkspaceCreations()[0]?.state).toBe("running");

		const handed: unknown[] = [];
		setWorkspaceCreationHandoff(async (ws, kickoff) => {
			handed.push({ id: ws.id, kickoff });
			return { sessionId: "s-replayed" };
		});
		await replayPendingHandoffs();
		expect(handed).toEqual([{ id: workspace.id, kickoff: { text: "still here" } }]);
		expect(listWorkspaceCreations()).toEqual([]);
		expect(removed().at(-1)).toMatchObject({ id: workspace.id, sessionId: "s-replayed" });
	},
);

posix("a folder that appears at the reserved path is reported and never deleted", async () => {
	const origin = join(dataDir, "origin.git");
	git(dataDir, "init", "--bare", "-b", "main", origin);
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "origin", "main");
	git(repo, "update-ref", "-d", "refs/remotes/origin/main");
	const creation = startWorkspaceCreation("p1", { baseRef: "origin/main" });
	const path = join(dataDir, "worktrees", "repo", "workspace-1");
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "precious.txt"), "keep\n");

	await expect(awaitWorkspaceCreation(creation.id)).rejects.toThrow("already exists");
	expect(readFileSync(join(path, "precious.txt"), "utf8")).toBe("keep\n");
	expect(listWorkspaceCreations()[0]?.failure?.cleanedUp).toBeUndefined();
	await dismissWorkspaceCreation(creation.id);
	expect(existsSync(join(path, "precious.txt"))).toBe(true);
});

posix("a cleanup that cannot finish claims nothing and leaves the record retryable", async () => {
	hook("mkdir -p locked && touch locked/f && chmod 555 locked && exit 1");
	const path = join(dataDir, "worktrees", "repo", "workspace-1");
	const creation = startWorkspaceCreation("p1");
	try {
		await expect(awaitWorkspaceCreation(creation.id)).rejects.toThrow("post-checkout hook failed");
		const [record] = listWorkspaceCreations();
		expect(record?.state).toBe("failed");
		expect(record?.failure?.cleanedUp).toBeUndefined();
		expect(existsSync(path)).toBe(true);

		chmodSync(join(path, "locked"), 0o755);
		hook("true");
		retryWorkspaceCreation(creation.id);
		const workspace = await awaitWorkspaceCreation(creation.id);
		expect(workspace.branch).toBe("workspace-1");
		expect(existsSync(join(workspace.worktreePath, "locked"))).toBe(false);
	} finally {
		if (existsSync(join(path, "locked"))) chmodSync(join(path, "locked"), 0o755);
	}
});

posix("every project door refuses a creation's folder, including a ~ path", async () => {
	setProjectPathGuard((path) => {
		if (creationOwnsPath(path)) throw new Error("still creating");
	});
	const savedHome = process.env.HOME;
	process.env.HOME = dataDir;
	hook("sleep 1");
	try {
		const creation = startWorkspaceCreation("p1");
		await until(() => listWorkspaceCreations()[0]?.phase === "checking-out");
		expect(() => openProject("~/worktrees/repo/workspace-1")).toThrow("still creating");
		expect(() => initProject("~/worktrees/repo/workspace-1")).toThrow("still creating");
		expect(() => createProject("~/worktrees/repo/workspace-1", "nested")).toThrow("still creating");
		expect(() =>
			inspectCloneDestination(join(dataDir, "worktrees", "repo", "workspace-1"), "c"),
		).toThrow("still creating");
		await awaitWorkspaceCreation(creation.id);
	} finally {
		setProjectPathGuard(null);
		process.env.HOME = savedHome;
	}
});

test("checkout failure text drops progress lines and keeps git's last words", () => {
	expect(
		checkoutFailureText(
			"Updating files:  10% (1/10)\rUpdating files:  20% (2/10)\rerror: unable to create file x: No space left on device\nfatal: cannot create directory\n",
		),
	).toBe("error: unable to create file x: No space left on device\nfatal: cannot create directory");
});
