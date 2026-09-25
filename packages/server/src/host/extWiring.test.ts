import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXT_SDK_GUIDE, projectExtensionsDir } from "../ext";
import { setProjectPublisher } from "../projects";
import { installExtHost } from "./extWiring";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "test-client" };
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let dataDir: string;
let repo: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-extwiring-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	const dir = join(projectExtensionsDir(repo), "demo");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "extension.json"),
		JSON.stringify({ name: "demo", surfaces: [{ id: "main", slot: "panel" }] }),
	);
	writeFileSync(
		join(dir, "index.ts"),
		'import { defineExtension } from "@thinkrail/ext";\nexport default defineExtension(() => {});\n',
	);
	writeFileSync(join(dir, "main.tsx"), "export default () => null;\n");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	setProjectPublisher(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("project.setTrust loads and unloads the project's extensions", async () => {
	const { extHost, syncProjectRoots, dispose } = installExtHost();
	let published: Promise<void> | undefined;
	setProjectPublisher(() => {
		published = syncProjectRoots();
	});
	try {
		await syncProjectRoots();
		expect(extHost.list()).toEqual([]);

		await handleRequest("project.setTrust", { id: "p1", trusted: true }, CTX);
		expect(published).toBeDefined();
		await published;
		expect(extHost.get("demo")).toMatchObject({
			scope: "project",
			projectId: "p1",
			status: "active",
		});

		published = undefined;
		await handleRequest("project.setTrust", { id: "p1", trusted: false }, CTX);
		expect(published).toBeDefined();
		await published;
		expect(extHost.list()).toEqual([]);
	} finally {
		await dispose();
	}
});

test("installing the host writes the SDK guide the agent prompt points at", async () => {
	const { dispose } = installExtHost();
	try {
		expect(readFileSync(join(dataDir, "ext-sdk", "README.md"), "utf8")).toBe(EXT_SDK_GUIDE);
	} finally {
		await dispose();
	}
});
