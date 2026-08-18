import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	LayoutChangedPayload,
	LayoutPreset,
	LayoutReplaceResult,
	LayoutSettings,
	LayoutSideGroup,
	WorkspaceLayoutDocument,
	WorkspaceLayoutSnapshot,
} from "@thinkrail/contracts";
import {
	getWorkspaceLayout,
	normalizeStoredLayoutSettings,
	removeWorkspaceLayout,
	replaceWorkspaceLayout,
	resetLayoutsForTests,
	setLayoutPublisher,
	validateLayoutPreset,
	validateLayoutSettings,
	validateWorkspaceLayout,
} from "./layout";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function document(name = "README.md"): WorkspaceLayoutDocument {
	return {
		version: 1,
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
					tabs: [{ kind: "tool", id: "tool:files", name: "All files", tool: "files" }],
				},
			],
		},
		toolRestoreTargets: {},
	};
}

function preset(id: string): LayoutPreset {
	return {
		id,
		name: id,
		center: { kind: "group", id: `${id}-center` },
		left: { visible: false, width: 0.2, groups: [] },
		right: {
			visible: true,
			width: 0.2,
			groups: [
				{ id: `${id}-one`, weight: 1 / 3, folded: false, tools: ["files"] },
				{ id: `${id}-two`, weight: 1 / 3, folded: false, tools: ["changes"] },
				{ id: `${id}-three`, weight: 1 / 3, folded: false, tools: ["review"] },
			],
		},
	};
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-layout-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetLayoutsForTests();
});

afterEach(() => {
	setLayoutPublisher(null);
	resetLayoutsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

describe("workspace layout validation", () => {
	test("accepts the protocol document and rejects unknown or browser-only fields", () => {
		expect(validateWorkspaceLayout(document(), 6)).toEqual(document());
		const withInlineContent = structuredClone(document()) as WorkspaceLayoutDocument & {
			content?: string;
		};
		withInlineContent.content = "not legal shared state";
		expect(() => validateWorkspaceLayout(withInlineContent, 6)).toThrow("unknown field");

		const virtual = document();
		if (virtual.center.kind !== "group") throw new Error("expected group");
		virtual.center.tabs = [
			{
				kind: "document",
				id: "todo:s1",
				name: "TODO",
				documentKind: "todo-plan",
				sourceId: "s1",
				docPath: "TODO.md",
				content: "inline markdown",
			} as never,
		];
		expect(() => validateWorkspaceLayout(virtual, 6)).toThrow("unknown field");
		delete (virtual.center.tabs[0] as { content?: string }).content;
		(virtual.center.tabs[0] as { docPath: string }).docPath = "../TODO.md";
		expect(() => validateWorkspaceLayout(virtual, 6)).toThrow("Invalid virtual document");

		const chatPreview = document();
		if (chatPreview.center.kind !== "group") throw new Error("expected group");
		chatPreview.center.tabs = [{ kind: "chat", id: "chat", name: "Chat", sessionId: "session" }];
		chatPreview.center.previewTabId = "chat";
		expect(() => validateWorkspaceLayout(chatPreview, 6)).toThrow("invalid preview");

		const unsafeRestore = document();
		unsafeRestore.toolRestoreTargets.files = {
			side: "right",
			index: Number.MAX_SAFE_INTEGER + 1,
		};
		expect(() => validateWorkspaceLayout(unsafeRestore, 6)).toThrow("Invalid restore target");
	});

	test("rejects noncanonical resource paths and more than one empty center leaf", () => {
		const pathAlias = document();
		if (pathAlias.center.kind !== "group") throw new Error("expected group");
		pathAlias.center.tabs.push({
			kind: "file",
			id: "file:alias",
			name: "README alias",
			path: "./README.md",
		});
		expect(() => validateWorkspaceLayout(pathAlias, 6)).toThrow("Invalid file tab");
		pathAlias.center.tabs[1] = {
			kind: "file",
			id: "file:alias",
			name: "README alias",
			path: "folder\\README.md",
		};
		expect(() => validateWorkspaceLayout(pathAlias, 6)).toThrow("Invalid file tab");
		pathAlias.center.tabs[1] = {
			kind: "file",
			id: "file:alias",
			name: "README alias",
			path: "C:/outside/README.md",
		};
		expect(() => validateWorkspaceLayout(pathAlias, 6)).toThrow("Invalid file tab");

		const emptyLeaves = document();
		emptyLeaves.center = {
			kind: "split",
			id: "split",
			direction: "horizontal",
			weights: [0.5, 0.5],
			children: [
				{ kind: "group", id: "empty-a", tabs: [] },
				{ kind: "group", id: "empty-b", tabs: [] },
			],
		};
		expect(() => validateWorkspaceLayout(emptyLeaves, 6)).toThrow("Only one empty center group");

		const badGeometry = document();
		const rightGroup = badGeometry.right.groups[0];
		if (!rightGroup) throw new Error("missing right group fixture");
		rightGroup.weight = 2;
		expect(() => validateWorkspaceLayout(badGeometry, 6)).toThrow("not normalized");
		rightGroup.weight = 1;
		badGeometry.left.width = 0.7;
		badGeometry.right.width = 0.4;
		expect(() => validateWorkspaceLayout(badGeometry, 6)).toThrow("no center region");
	});

	test("enforces byte-accurate budgets and rejects unserializable values", () => {
		const byteHeavy = { ...document(), padding: "界".repeat(180_000) };
		expect(() => validateWorkspaceLayout(byteHeavy, 6)).toThrow("Layout snapshot is too large");
		expect(() => validateWorkspaceLayout({ ...document(), padding: 1n }, 6)).toThrow(
			"Layout snapshot is too large",
		);
		expect(() =>
			validateLayoutSettings({
				defaultPresetId: "界".repeat(180_000),
				customPresets: [],
				maxSideGroups: 6,
			}),
		).toThrow("Layout settings are too large");
	});

	test("accepts opaque singleton-tool placement ids", () => {
		const opaque = document();
		const filesGroup = opaque.right.groups[0];
		if (!filesGroup) throw new Error("missing tool group fixture");
		const files = filesGroup.tabs[0];
		if (files?.kind !== "tool") throw new Error("missing tool fixture");
		filesGroup.tabs[0] = { ...files, id: "legacy-files-placement" };
		expect(validateWorkspaceLayout(opaque, 6)).toEqual(opaque);

		const collision = document();
		if (collision.center.kind !== "group") throw new Error("expected group");
		collision.center.tabs.push({
			kind: "terminal",
			id: "tool:review",
			name: "Terminal",
			tabKey: "collision",
		});
		expect(validateWorkspaceLayout(collision, 6)).toEqual(collision);
	});

	test("rejects one canonical resource smuggled under two placement ids", () => {
		const duplicate = document();
		if (duplicate.center.kind !== "group") throw new Error("expected group");
		duplicate.center.tabs.push({
			kind: "terminal",
			id: "terminal:center-alias",
			name: "Terminal",
			tabKey: "shared-terminal",
		});
		duplicate.right.groups[0]?.tabs.push({
			kind: "terminal",
			id: "terminal:side-alias",
			name: "Terminal alias",
			tabKey: "shared-terminal",
		});
		expect(() => validateWorkspaceLayout(duplicate, 6)).toThrow(
			"Duplicate canonical resource: terminal shared-terminal",
		);

		const delimiterSafe = document();
		if (delimiterSafe.center.kind !== "group") throw new Error("expected group");
		delimiterSafe.center.tabs.push(
			{
				kind: "diff",
				id: "diff:one",
				name: "One",
				path: "a",
				scope: { kind: "commit", sha: "x:commit:y" },
			},
			{
				kind: "diff",
				id: "diff:two",
				name: "Two",
				path: "a:commit:x",
				scope: { kind: "commit", sha: "y" },
			},
		);
		expect(() => validateWorkspaceLayout(delimiterSafe, 6)).not.toThrow();
	});

	test("grandfathers only the currently accepted side overage", () => {
		const current = document();
		const makeGroup = (index: number): LayoutSideGroup => ({
			id: `extra-${index}`,
			weight: 1,
			folded: false,
			tabs: [
				{
					kind: "terminal",
					id: `terminal:${index}`,
					name: `Terminal ${index}`,
					tabKey: `terminal-${index}`,
				},
			],
		});
		current.right.groups = Array.from({ length: 7 }, (_, index) => ({
			...makeGroup(index),
			weight: 1 / 7,
		}));
		const sameCount = structuredClone(current);
		expect(validateWorkspaceLayout(sameCount, 6, current)).toEqual(sameCount);
		const increased = structuredClone(current);
		increased.right.groups.push({ ...makeGroup(7), weight: 1 / 7 });
		expect(() => validateWorkspaceLayout(increased, 6, current)).toThrow("group limit");
	});

	test("rejects unnormalized portable preset geometry", () => {
		const badSide = preset("bad-side");
		const first = badSide.right.groups[0];
		if (!first) throw new Error("missing preset group fixture");
		first.weight = 0.5;
		expect(() => validateLayoutPreset(badSide)).toThrow("not normalized");

		const badSplit = preset("bad-split");
		badSplit.center = {
			kind: "split",
			id: "bad-split-root",
			direction: "horizontal",
			weights: [0.8, 0.8],
			children: [
				{ kind: "group", id: "bad-split-a" },
				{ kind: "group", id: "bad-split-b" },
			],
		};
		expect(() => validateLayoutPreset(badSplit)).toThrow("Malformed layout preset split");
	});

	test("normalizes persisted custom presets without rewriting opaque built-in ids", () => {
		const valid = preset("custom-valid");
		const normalized = normalizeStoredLayoutSettings({
			defaultPresetId: "future-built-in",
			customPresets: [valid, valid, { id: "broken" } as never],
			maxSideGroups: 1,
		});
		expect(normalized).toEqual({
			defaultPresetId: "future-built-in",
			customPresets: [valid],
			maxSideGroups: 3,
		});

		const selectedInvalid: LayoutSettings = {
			defaultPresetId: "broken",
			customPresets: [{ id: "broken" } as never],
			maxSideGroups: 1,
		};
		expect(normalizeStoredLayoutSettings(selectedInvalid)).toEqual({
			defaultPresetId: "balanced",
			customPresets: [],
			maxSideGroups: 6,
		});

		const capped = normalizeStoredLayoutSettings({
			defaultPresetId: "balanced",
			customPresets: Array.from({ length: 40 }, (_, index) => preset(`custom-${index}`)),
			maxSideGroups: 6,
		});
		expect(capped.customPresets).toHaveLength(32);
	});

	test("validates layout settings as one complete strict nested value", () => {
		expect(
			validateLayoutSettings({ defaultPresetId: "balanced", customPresets: [], maxSideGroups: 6 }),
		).toEqual({ defaultPresetId: "balanced", customPresets: [], maxSideGroups: 6 });
		expect(() => validateLayoutSettings({ defaultPresetId: "balanced", maxSideGroups: 6 })).toThrow(
			"Invalid layout settings",
		);
		expect(() =>
			validateLayoutSettings({
				defaultPresetId: "balanced",
				customPresets: [],
				maxSideGroups: 6,
				extra: true,
			}),
		).toThrow("unknown field");
		expect(() =>
			validateLayoutPreset({
				id: "empty-visible",
				name: "Empty visible side",
				center: { kind: "group", id: "center" },
				left: { visible: true, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
			}),
		).toThrow("cannot be visible while empty");
	});
});

describe("workspace layout persistence and ordering", () => {
	function accepted(result: LayoutReplaceResult): LayoutChangedPayload {
		if (result.status === "conflict") throw new Error("expected accepted layout replacement");
		return result.payload;
	}

	test("serializes dependent writes with the revision produced by their predecessor", async () => {
		const seen: LayoutChangedPayload[] = [];
		setLayoutPublisher((payload) => seen.push(payload));
		const first = replaceWorkspaceLayout(
			{
				workspaceId: "ws",
				mutationId: "first",
				expectedRevision: null,
				document: document("first.ts"),
			},
			6,
		);
		const second = replaceWorkspaceLayout(
			{
				workspaceId: "ws",
				mutationId: "second",
				expectedRevision: 1,
				document: document("second.ts"),
			},
			6,
		);
		const payloads = (await Promise.all([first, second])).map(accepted);
		expect(payloads.map((payload) => payload.snapshot.revision)).toEqual([1, 2]);
		expect(seen.map((payload) => [payload.snapshot.revision, payload.mutationId])).toEqual([
			[1, "first"],
			[2, "second"],
		]);
		expect(getWorkspaceLayout("ws")?.document).toEqual(document("second.ts"));
		const persisted = JSON.parse(
			readFileSync(join(dataDir, "layouts", "ws.json"), "utf8"),
		) as WorkspaceLayoutSnapshot;
		expect(persisted.revision).toBe(2);
	});

	test("two clients replacing the same revision accept exactly one and return current on conflict", async () => {
		accepted(
			await replaceWorkspaceLayout(
				{
					workspaceId: "ws",
					mutationId: "seed",
					expectedRevision: null,
					document: document("seed.ts"),
				},
				6,
			),
		);
		const seen: LayoutChangedPayload[] = [];
		setLayoutPublisher((payload) => seen.push(payload));

		const [winner, loser] = await Promise.all([
			replaceWorkspaceLayout(
				{
					workspaceId: "ws",
					mutationId: "client-a",
					expectedRevision: 1,
					document: document("client-a.ts"),
				},
				6,
			),
			replaceWorkspaceLayout(
				{
					workspaceId: "ws",
					mutationId: "client-b",
					expectedRevision: 1,
					document: document("client-b.ts"),
				},
				6,
			),
		]);

		expect(winner).toEqual({
			status: "accepted",
			payload: {
				snapshot: { workspaceId: "ws", revision: 2, document: document("client-a.ts") },
				mutationId: "client-a",
			},
		});
		expect(loser).toEqual({
			status: "conflict",
			current: { workspaceId: "ws", revision: 2, document: document("client-a.ts") },
		});
		expect(seen).toEqual([
			{
				snapshot: { workspaceId: "ws", revision: 2, document: document("client-a.ts") },
				mutationId: "client-a",
			},
		]);
		expect(getWorkspaceLayout("ws")).toEqual({
			workspaceId: "ws",
			revision: 2,
			document: document("client-a.ts"),
		});
		const persisted = JSON.parse(
			readFileSync(join(dataDir, "layouts", "ws.json"), "utf8"),
		) as WorkspaceLayoutSnapshot;
		const current = getWorkspaceLayout("ws");
		if (!current) throw new Error("accepted layout disappeared");
		expect(persisted).toEqual(current);
	});

	test("first creation requires an expected absent revision", async () => {
		const seen: LayoutChangedPayload[] = [];
		setLayoutPublisher((payload) => seen.push(payload));
		await expect(
			replaceWorkspaceLayout(
				{
					workspaceId: "ws",
					mutationId: "numeric-create",
					expectedRevision: 0,
					document: document("stale.ts"),
				},
				6,
			),
		).resolves.toEqual({ status: "conflict", current: null });
		expect(getWorkspaceLayout("ws")).toBeNull();
		expect(seen).toEqual([]);

		const created = await replaceWorkspaceLayout(
			{
				workspaceId: "ws",
				mutationId: "create",
				expectedRevision: null,
				document: document("created.ts"),
			},
			6,
		);
		expect(accepted(created).snapshot.revision).toBe(1);
	});

	test("encodes legacy workspace ids instead of letting them escape the layout directory", async () => {
		const workspaceId = "../legacy workspace";
		await replaceWorkspaceLayout(
			{ workspaceId, mutationId: "safe-path", expectedRevision: null, document: document() },
			6,
		);
		resetLayoutsForTests();
		expect(getWorkspaceLayout(workspaceId)?.workspaceId).toBe(workspaceId);
		const file = `~${Buffer.from(workspaceId).toString("base64url")}.json`;
		expect(JSON.parse(readFileSync(join(dataDir, "layouts", file), "utf8")).workspaceId).toBe(
			workspaceId,
		);
	});

	test("recovers a corrupt primary from the last-known-good snapshot", async () => {
		await replaceWorkspaceLayout(
			{
				workspaceId: "ws",
				mutationId: "first",
				expectedRevision: null,
				document: document("first.ts"),
			},
			6,
		);
		await replaceWorkspaceLayout(
			{
				workspaceId: "ws",
				mutationId: "second",
				expectedRevision: 1,
				document: document("second.ts"),
			},
			6,
		);
		writeFileSync(join(dataDir, "layouts", "ws.json"), "{broken");
		resetLayoutsForTests();
		const recovered = getWorkspaceLayout("ws");
		expect(recovered?.revision).toBe(1);
		expect(recovered?.document).toEqual(document("first.ts"));
	});

	test("uses a compatible backup but never overwrites a future primary", async () => {
		const directory = join(dataDir, "layouts");
		mkdirSync(directory, { recursive: true });
		const backup: WorkspaceLayoutSnapshot = {
			workspaceId: "ws",
			revision: 4,
			document: document(),
		};
		writeFileSync(join(directory, "ws.json.bak"), JSON.stringify(backup));
		writeFileSync(
			join(directory, "ws.json"),
			JSON.stringify({ workspaceId: "ws", revision: 5, document: { version: 99 } }),
		);
		expect(getWorkspaceLayout("ws")).toEqual(backup);
		await expect(
			replaceWorkspaceLayout(
				{
					workspaceId: "ws",
					mutationId: "older-host",
					expectedRevision: 4,
					document: document("overwrite.ts"),
				},
				6,
			),
		).rejects.toThrow("read-only");
		const primary = JSON.parse(readFileSync(join(directory, "ws.json"), "utf8"));
		expect(primary.document.version).toBe(99);
	});

	test("a workspace removal cancels a queued write before it can resurrect persistence", async () => {
		const pending = replaceWorkspaceLayout(
			{ workspaceId: "ws", mutationId: "racing", expectedRevision: null, document: document() },
			6,
		);
		removeWorkspaceLayout("ws");
		await expect(pending).rejects.toThrow("removed before the write completed");
		expect(getWorkspaceLayout("ws")).toBeNull();
	});

	test("removes primary, backup, and cache with the workspace", async () => {
		await replaceWorkspaceLayout(
			{ workspaceId: "ws", mutationId: "first", expectedRevision: null, document: document() },
			6,
		);
		removeWorkspaceLayout("ws");
		expect(getWorkspaceLayout("ws")).toBeNull();
	});
});
