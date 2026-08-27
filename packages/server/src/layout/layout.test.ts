import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceLayoutDocument, WorkspaceLayoutSnapshot } from "@thinkrail/contracts";
import {
	getWorkspaceLayout,
	removeWorkspaceLayout,
	resetLayoutsForTests,
	validateWorkspaceLayout,
} from "./layout";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const LIMITS = { maxSideGroups: 32, maxBottomGroups: 32 } as const;

function document(name = "README.md"): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "file", id: `file:${name}`, name, path: name }],
		},
		left: {
			visible: true,
			width: 0.18,
			groups: [
				{
					id: "left",
					weight: 1,
					folded: false,
					tabs: [{ kind: "tool", id: "tool:projects", name: "Projects", tool: "projects" }],
				},
			],
		},
		right: {
			visible: true,
			width: 0.28,
			groups: [
				{
					id: "right",
					weight: 1,
					folded: false,
					tabs: [{ kind: "tool", id: "tool:files", name: "Files", tool: "files" }],
				},
			],
		},
		bottom: {
			visible: true,
			height: 0.3,
			alignment: "center",
			groups: [{ id: "bottom", weight: 1, folded: false, tabs: [] }],
		},
		toolRestoreTargets: {},
	};
}

function legacyDocument(name = "README.md") {
	const current = document(name);
	const { bottom: _bottom, ...legacy } = current;
	return { ...legacy, version: 1 };
}

function layoutPath(workspaceId: string, suffix = ""): string {
	const id = /^[A-Za-z0-9_-]+$/.test(workspaceId)
		? workspaceId
		: `~${Buffer.from(workspaceId).toString("base64url")}`;
	return join(dataDir, "layouts", `${id}.json${suffix}`);
}

function writeLayout(workspaceId: string, value: unknown, suffix = ""): void {
	mkdirSync(join(dataDir, "layouts"), { recursive: true });
	writeFileSync(layoutPath(workspaceId, suffix), JSON.stringify(value));
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-layout-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetLayoutsForTests();
});

afterEach(() => {
	resetLayoutsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

describe("legacy workspace layout validation", () => {
	test("accepts a valid snapshot document and rejects unknown client-only content", () => {
		expect(validateWorkspaceLayout(document(), LIMITS)).toEqual(document());
		const invalid = structuredClone(document()) as WorkspaceLayoutDocument & {
			center: WorkspaceLayoutDocument["center"] & { content: string };
		};
		invalid.center.content = "browser cache";
		expect(() => validateWorkspaceLayout(invalid, LIMITS)).toThrow("unknown field");
	});

	test("accepts process-free bottom slots and rejects illegal side resources", () => {
		const valid = document();
		valid.bottom.groups = [{ id: "empty", weight: 1, folded: false, tabs: [] }];
		expect(validateWorkspaceLayout(valid, LIMITS)).toEqual(valid);
		const invalid = document();
		invalid.right.groups[0]?.tabs.push({
			kind: "terminal",
			id: "terminal",
			name: "Terminal",
			tabKey: "terminal",
		});
		invalid.right.groups[0]?.tabs.push({
			kind: "tool",
			id: "duplicate-tool",
			name: "Files",
			tool: "files",
		});
		expect(() => validateWorkspaceLayout(invalid, LIMITS)).toThrow("Duplicate singleton tool");
	});

	test("rejects noncanonical paths and duplicate semantic resources", () => {
		const pathAlias = document();
		if (pathAlias.center.kind !== "group") throw new Error("expected center group");
		pathAlias.center.tabs[0] = {
			kind: "file",
			id: "bad-path",
			name: "bad",
			path: "src/../README.md",
		};
		expect(() => validateWorkspaceLayout(pathAlias, LIMITS)).toThrow("Invalid file tab");

		const duplicate = document();
		if (duplicate.center.kind !== "group") throw new Error("expected center group");
		duplicate.center.tabs.push({
			kind: "file",
			id: "second-placement",
			name: "README.md",
			path: "README.md",
		});
		expect(() => validateWorkspaceLayout(duplicate, LIMITS)).toThrow(
			"Duplicate canonical resource",
		);
	});
});

describe("read-only legacy layout import", () => {
	test("reads a current snapshot without rewriting it", () => {
		const snapshot: WorkspaceLayoutSnapshot = {
			workspaceId: "ws",
			revision: 7,
			document: document(),
		};
		writeLayout("ws", snapshot);
		const before = readFileSync(layoutPath("ws"), "utf8");
		expect(getWorkspaceLayout("ws")).toEqual(snapshot);
		expect(readFileSync(layoutPath("ws"), "utf8")).toBe(before);
	});

	test("migrates version one in memory and floors its reported revision", () => {
		writeLayout("ws", { workspaceId: "ws", revision: 1, document: legacyDocument() });
		const before = readFileSync(layoutPath("ws"), "utf8");
		const migrated = getWorkspaceLayout("ws");
		expect(migrated?.revision).toBe(2);
		expect(migrated?.document.bottom).toEqual({
			visible: false,
			height: 0.3,
			alignment: "center",
			groups: [],
		});
		expect(readFileSync(layoutPath("ws"), "utf8")).toBe(before);
	});

	test("falls back to a compatible backup when the primary is corrupt or from the future", () => {
		const backup: WorkspaceLayoutSnapshot = {
			workspaceId: "ws",
			revision: 4,
			document: document("backup.ts"),
		};
		writeLayout("ws", backup, ".bak");
		writeFileSync(layoutPath("ws"), "not-json");
		expect(getWorkspaceLayout("ws")).toEqual(backup);

		resetLayoutsForTests();
		writeLayout("ws", { workspaceId: "ws", revision: 9, document: { version: 99 } });
		expect(getWorkspaceLayout("ws")).toEqual(backup);
	});

	test("refuses an unreadable future snapshot when no compatible backup exists", () => {
		writeLayout("ws", { workspaceId: "ws", revision: 9, document: { version: 99 } });
		expect(() => getWorkspaceLayout("ws")).toThrow("newer host");
	});

	test("encodes unsafe workspace ids and cleanup removes primary plus backup", () => {
		const workspaceId = "../legacy/workspace";
		const snapshot: WorkspaceLayoutSnapshot = {
			workspaceId,
			revision: 3,
			document: document(),
		};
		writeLayout(workspaceId, snapshot);
		writeLayout(workspaceId, snapshot, ".bak");
		expect(getWorkspaceLayout(workspaceId)).toEqual(snapshot);
		removeWorkspaceLayout(workspaceId);
		expect(existsSync(layoutPath(workspaceId))).toBe(false);
		expect(existsSync(layoutPath(workspaceId, ".bak"))).toBe(false);
	});
});
