import { describe, expect, test } from "bun:test";
import type {
	LayoutCenterTab,
	LayoutTerminalTab,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import type { LayoutAttention } from "../../lib";
import {
	canShowSide,
	closeLayoutTab,
	closePlacedResource,
	collectAllGroups,
	collectCenterGroups,
	createSideGroup,
	findTabLocation,
	hideSide,
	isLayoutUnavailable,
	type LayoutOperationResult,
	moveTabToGroup,
	openCenterTab,
	reconcileAttention,
	removeSessionLayoutTabs,
	resizeSideGroups,
	resizeSideRegion,
	revealTool,
	selectTab,
	setSideGroupFolded,
	setSideVisibility,
	showSide,
	splitCenterGroup,
	toolTab,
	validateLayoutDocument,
	withAvailablePlacementId,
} from "./model";
import {
	applyLayoutPreset,
	BUILTIN_LAYOUT_PRESETS,
	captureLayoutPreset,
	instantiateLayoutPreset,
} from "./presets";

const file = (id: string): LayoutCenterTab => ({
	kind: "file",
	id,
	name: `${id}.ts`,
	path: `${id}.ts`,
});

function baseDocument(tabs: LayoutCenterTab[] = []): WorkspaceLayoutDocument {
	return {
		version: 1,
		center: { kind: "group", id: "center-a", tabs },
		left: {
			visible: true,
			width: 0.18,
			groups: [{ id: "left-a", weight: 1, folded: false, tabs: [toolTab("projects")] }],
		},
		right: {
			visible: true,
			width: 0.28,
			groups: [{ id: "right-a", weight: 1, folded: false, tabs: [toolTab("files")] }],
		},
		toolRestoreTargets: {},
	};
}

function mutation<T extends { document: WorkspaceLayoutDocument } | { reason: string }>(result: T) {
	if ("reason" in result) throw new Error(result.reason);
	return result;
}

describe("workspace layout model", () => {
	test("opens one canonical tab and keeps preview promotion one-way", () => {
		let document = baseDocument();
		document = mutation(openCenterTab(document, file("one"), "center-a", "preview")).document;
		expect(document.center.kind).toBe("group");
		if (document.center.kind !== "group") return;
		expect(document.center.previewTabId).toBe("one");
		document = mutation(openCenterTab(document, file("two"), "center-a", "preview")).document;
		if (document.center.kind !== "group") return;
		expect(document.center.tabs.map((tab) => tab.id)).toEqual(["two"]);
		document = mutation(openCenterTab(document, file("two"), "center-a", "keep")).document;
		if (document.center.kind !== "group") return;
		expect(document.center.previewTabId).toBeUndefined();
		const reopened = mutation(openCenterTab(document, file("two"), "center-a", "preview"));
		expect(reopened.document).toBe(document);
		expect(reopened.focusTabId).toBe("two");
		const canonicalAlias = { ...file("alias"), path: "two.ts" };
		const deduplicated = mutation(openCenterTab(document, canonicalAlias, "center-a", "keep"));
		expect(deduplicated.document).toBe(document);
		expect(deduplicated.focusTabId).toBe("two");
		const identityMutation = openCenterTab(
			document,
			{ ...file("two"), path: "other.ts", name: "Not the same resource" },
			"center-a",
			"keep",
		);
		expect(identityMutation).toEqual({ reason: "That tab id belongs to another resource." });

		const chat: LayoutCenterTab = {
			kind: "chat",
			id: "chat:one",
			name: "Chat",
			sessionId: "one",
		};
		document = mutation(openCenterTab(document, chat, "center-a", "preview")).document;
		if (document.center.kind !== "group") throw new Error("expected one center group");
		expect(document.center.previewTabId).toBeUndefined();
		expect(openCenterTab(document, { ...chat, id: "two" }, "center-a", "keep")).toEqual({
			reason: "That tab id belongs to another resource.",
		});
		const renamed = mutation(
			openCenterTab(document, { ...chat, name: "Plan the migration" }, "center-a", "keep"),
		);
		const placed = collectCenterGroups(renamed.document.center).flatMap((group) => group.tabs);
		expect(placed).toContainEqual({ ...chat, name: "Plan the migration" });
		expect(placed).toHaveLength(2);
	});

	test("a coalesced preview-to-keep open claims the preview slot in one final mutation", () => {
		let document = mutation(
			openCenterTab(baseDocument(), file("previewed"), "center-a", "preview"),
		).document;
		document = mutation(openCenterTab(document, file("kept"), "center-a", "keep", true)).document;
		if (document.center.kind !== "group") throw new Error("expected one center group");
		expect(document.center.tabs.map((tab) => tab.id)).toEqual(["kept"]);
		expect(document.center.previewTabId).toBeUndefined();
	});

	test("builds recursive splits, enforces four leaves, and promotes the surviving sibling", () => {
		let document = baseDocument([file("one"), file("two"), file("three"), file("four")]);
		expect(
			isLayoutUnavailable(splitCenterGroup(document, "center-a", "right", file("missing"))),
		).toBe(true);
		expect(
			isLayoutUnavailable(
				splitCenterGroup(document, "center-a", "right", { ...file("one"), path: "not-one.ts" }),
			),
		).toBe(true);
		for (const direction of ["right", "down", "left"] as const) {
			const group = collectCenterGroups(document.center).find(
				(candidate) => candidate.tabs.length > 1,
			);
			const tab = group?.tabs.at(-1);
			if (!group || !tab) throw new Error("missing splittable center group");
			document = mutation(splitCenterGroup(document, group.id, direction, tab)).document;
		}
		expect(collectCenterGroups(document.center)).toHaveLength(4);
		const blockedGroup = collectCenterGroups(document.center)[0];
		const blockedTab = blockedGroup?.tabs[0];
		if (!blockedGroup || !blockedTab) throw new Error("missing blocked split fixture");
		const blocked = splitCenterGroup(document, blockedGroup.id, "up", blockedTab);
		expect(isLayoutUnavailable(blocked)).toBe(true);

		const source = collectCenterGroups(document.center).find((group) => group.tabs.length > 0);
		if (!source) throw new Error("missing populated center group");
		for (const tab of [...source.tabs]) document = closeLayoutTab(document, tab.id).document;
		expect(collectCenterGroups(document.center)).toHaveLength(3);

		let singleton = baseDocument([file("alpha"), file("beta")]);
		singleton = mutation(splitCenterGroup(singleton, "center-a", "right", file("beta"))).document;
		const alphaGroup = collectCenterGroups(singleton.center).find((group) =>
			group.tabs.some((tab) => tab.id === "alpha"),
		);
		if (!alphaGroup) throw new Error("missing singleton split source");
		singleton = mutation(
			splitCenterGroup(singleton, alphaGroup.id, "down", file("alpha")),
		).document;
		expect(
			collectCenterGroups(singleton.center).filter((group) => group.tabs.length === 0),
		).toHaveLength(1);
	});

	test("moves terminals across domains but rejects side placement for files", () => {
		const terminal: LayoutTerminalTab = {
			kind: "terminal",
			// Shared placement ids stay stable even when they predate the current browser's id convention.
			id: "legacy-stable-terminal-placement",
			name: "Terminal 1",
			tabKey: "t1",
		};
		let document = baseDocument([file("one"), terminal]);
		document = mutation(
			moveTabToGroup(document, terminal, { area: "right", groupId: "right-a" }),
		).document;
		expect(findTabLocation(document, terminal.id)).toEqual({ area: "right", groupId: "right-a" });
		const renamedTerminal = { ...terminal, name: "Build shell" };
		document = mutation(openCenterTab(document, renamedTerminal, "center-a", "preview")).document;
		expect(
			collectAllGroups(document)
				.flatMap((group) => group.tabs)
				.find((tab) => tab.id === terminal.id)?.name,
		).toBe("Build shell");
		expect(findTabLocation(document, terminal.id)).toEqual({ area: "right", groupId: "right-a" });
		const illegal = moveTabToGroup(document, file("one"), { area: "right", groupId: "right-a" });
		expect(isLayoutUnavailable(illegal)).toBe(true);
		document = mutation(
			moveTabToGroup(
				document,
				{ ...renamedTerminal, id: "terminal:canonical-alias" },
				{ area: "center", groupId: "center-a" },
			),
		).document;
		expect(findTabLocation(document, terminal.id)?.area).toBe("center");
		expect(findTabLocation(document, "terminal:canonical-alias")).toBeNull();
	});

	test("rejects no-op moves and preserves identity when a missing tab is closed", () => {
		const document = baseDocument([file("one"), file("two")]);
		const noChange = moveTabToGroup(
			document,
			file("one"),
			{ area: "center", groupId: "center-a" },
			0,
		);
		expect(noChange).toEqual({ reason: "That tab is already at this position." });
		expect(
			moveTabToGroup(
				document,
				{ ...file("one"), path: "other.ts" },
				{ area: "center", groupId: "center-a" },
			),
		).toEqual({ reason: "That tab id belongs to another resource." });
		const remapped = withAvailablePlacementId(document, {
			...file("one"),
			path: "other.ts",
		});
		expect(remapped.id).not.toBe("one");
		expect(remapped.path).toBe("other.ts");
		expect(closeLayoutTab(document, "missing").document).toBe(document);
	});

	test("a delayed close follows semantic identity and never closes a reused placement id", () => {
		const captured: LayoutTerminalTab = {
			kind: "terminal",
			id: "reused-placement",
			name: "Terminal",
			tabKey: "terminal-one",
		};
		const movedPlacement = { ...captured, id: "moved-placement" };
		const document = baseDocument([movedPlacement]);
		const moved = closePlacedResource(document, captured).document;
		expect(findTabLocation(moved, movedPlacement.id)).toBeNull();

		const reused = baseDocument([{ ...file("replacement"), id: captured.id }]);
		expect(closePlacedResource(reused, captured).document).toBe(reused);
		expect(findTabLocation(reused, captured.id)).toEqual({
			area: "center",
			groupId: "center-a",
		});
	});

	test("records singleton restore targets and reveals closed tools unfolded in place", () => {
		let document = baseDocument();
		document = mutation(setSideGroupFolded(document, "right", "right-a", true)).document;
		document = closeLayoutTab(document, "tool:files").document;
		expect(document.right.groups).toHaveLength(0);
		expect(document.right.visible).toBe(false);
		expect(document.toolRestoreTargets.files).toEqual({
			side: "right",
			groupId: "right-a",
			index: 0,
		});
		expect(canShowSide(document, "right")).toBe(true);
		const revealed = mutation(showSide(document, "right", 6));
		expect(revealed.document.right.visible).toBe(true);
		expect(revealed.document.right.groups[0]?.folded).toBe(false);
		expect(findTabLocation(revealed.document, "tool:files")?.area).toBe("right");
		expect(revealed.focusTabId).toBe("tool:files");

		const missingRestoreMetadata = { ...document, toolRestoreTargets: {} };
		expect(canShowSide(missingRestoreMetadata, "right")).toBe(true);
		expect(
			findTabLocation(
				mutation(showSide(missingRestoreMetadata, "right", 6)).document,
				"tool:specs",
			),
		).not.toBeNull();

		const attention = reconcileAttention(revealed.document, undefined);
		const hidden = hideSide(revealed.document, "right", attention);
		expect(hidden.document.right.visible).toBe(false);
		expect(hidden.focusGroupId).toBe("center-a");
		expect(hidden.focusTabId).toBeUndefined();

		let atLimit = baseDocument();
		atLimit = mutation(
			moveTabToGroup(atLimit, toolTab("changes"), { area: "right", groupId: "right-a" }),
		).document;
		atLimit = closeLayoutTab(atLimit, "tool:changes").document;
		atLimit = mutation(setSideGroupFolded(atLimit, "right", "right-a", true)).document;
		const joined = mutation(revealTool(atLimit, "changes", 1));
		expect(joined.document.right.groups).toHaveLength(1);
		expect(joined.document.right.groups[0]?.folded).toBe(false);
		expect(joined.document.right.groups[0]?.tabs.map((tab) => tab.id)).toEqual([
			"tool:files",
			"tool:changes",
		]);

		const legacy = baseDocument();
		const legacyFilesGroup = legacy.right.groups[0];
		if (!legacyFilesGroup) throw new Error("missing legacy tool group fixture");
		legacy.right.groups[0] = {
			...legacyFilesGroup,
			tabs: [{ ...toolTab("files"), id: "legacy-files-placement" }],
		};
		const focusedLegacy = mutation(revealTool(legacy, "files", 6));
		expect(focusedLegacy.document).toBe(legacy);
		expect(focusedLegacy.focusTabId).toBe("legacy-files-placement");

		const collidingTerminal: LayoutTerminalTab = {
			kind: "terminal",
			id: "tool:review",
			name: "Terminal",
			tabKey: "collision",
		};
		const collision = baseDocument([collidingTerminal]);
		const collisionReveal = mutation(revealTool(collision, "review", 6));
		const collisionTabs = collectAllGroups(collisionReveal.document).flatMap((group) => group.tabs);
		expect(collisionTabs).toContainEqual(collidingTerminal);
		expect(collisionTabs.find((tab) => tab.kind === "tool" && tab.tool === "review")?.id).not.toBe(
			"tool:review",
		);
		expect(validateLayoutDocument(collisionReveal.document, 6)).toEqual([]);
	});

	test("blocks growth at the side limit but permits a count-neutral edge reorder", () => {
		const document = baseDocument();
		expect(resizeSideRegion(document, "right", document.right.width)).toBe(document);
		expect(resizeSideGroups(document, "right", [100])).toBe(document);
		const blocked = createSideGroup(document, "right", toolTab("changes"), 1, 1);
		expect(isLayoutUnavailable(blocked)).toBe(true);
		const noOp = createSideGroup(document, "right", toolTab("files"), 0, 1);
		expect(noOp).toEqual({ reason: "That tab is already at this position." });

		let grown = mutation(createSideGroup(document, "right", toolTab("changes"), 1, 2)).document;
		const reordered = mutation(
			createSideGroup(grown, "right", toolTab("files"), grown.right.groups.length, 1),
		);
		grown = reordered.document;
		expect(grown.right.groups).toHaveLength(2);
		expect(grown.right.groups.map((group) => group.tabs[0]?.id)).toEqual([
			"tool:changes",
			"tool:files",
		]);
		expect(grown.right.groups.map((group) => group.weight)).toEqual([0.5, 0.5]);
		expect(validateLayoutDocument(grown, 1)).toContain("Too many right groups.");
		const foldedId = grown.right.groups[0]?.id;
		if (!foldedId) throw new Error("missing folded group fixture");
		grown = mutation(setSideGroupFolded(grown, "right", foldedId, true)).document;
		grown = resizeSideGroups(grown, "right", [5, 95]);
		expect(grown.right.groups[0]?.weight).toBe(0.5);
		expect(grown.right.groups[1]?.weight).toBe(0.5);
		expect(validateLayoutDocument(grown, 2)).toEqual([]);
		grown = mutation(setSideGroupFolded(grown, "right", foldedId, false)).document;
		grown = resizeSideGroups(grown, "right", [Number.MAX_VALUE, Number.MAX_VALUE]);
		expect(grown.right.groups.map((group) => group.weight)).toEqual([0.5, 0.5]);

		grown = resizeSideRegion(grown, "right", 0.7);
		grown = resizeSideRegion(grown, "left", 0.7);
		expect(grown.left.width + grown.right.width).toBeLessThan(1);
		expect(validateLayoutDocument(grown, 2)).toEqual([]);
	});

	test("inserts side groups at per-group boundaries after removing a singleton source", () => {
		let document = baseDocument();
		document = mutation(createSideGroup(document, "right", toolTab("changes"), 1, 6)).document;
		document = mutation(createSideGroup(document, "right", toolTab("review"), 2, 6)).document;

		document = mutation(createSideGroup(document, "right", toolTab("files"), 2, 6)).document;
		expect(document.right.groups.map((group) => group.tabs[0]?.id)).toEqual([
			"tool:changes",
			"tool:files",
			"tool:review",
		]);
		expect(createSideGroup(document, "right", toolTab("files"), 2, 6)).toEqual({
			reason: "That tab is already at this position.",
		});

		document = mutation(createSideGroup(document, "right", toolTab("files"), 3, 6)).document;
		expect(document.right.groups.map((group) => group.tabs[0]?.id)).toEqual([
			"tool:changes",
			"tool:review",
			"tool:files",
		]);

		let joined = baseDocument();
		joined = mutation(
			moveTabToGroup(joined, toolTab("changes"), { area: "right", groupId: "right-a" }),
		).document;
		const splitBelow = mutation(createSideGroup(joined, "right", toolTab("files"), 1, 6));
		expect(splitBelow.document.right.groups.map((group) => group.tabs[0]?.id)).toEqual([
			"tool:changes",
			"tool:files",
		]);
	});

	test("reconciles removed selection and focus to the nearest survivor", () => {
		const previous = baseDocument([file("one"), file("two"), file("three")]);
		const attention: LayoutAttention = {
			selectedByGroup: { "center-a": "two", "left-a": "tool:projects", "right-a": "tool:files" },
			lastFocusedCenterGroupId: "center-a",
			lastFocusedSideGroupId: { left: "left-a", right: "right-a" },
			navigationClockByGroup: { "center-a": 7 },
		};
		const next = closeLayoutTab(previous, "two").document;
		const reconciled = reconcileAttention(next, attention, previous);
		expect(reconciled.selectedByGroup["center-a"]).toBe("three");
		expect(reconciled.navigationClockByGroup["center-a"]).toBe(7);
		expect(selectTab(reconciled, { area: "center", groupId: "center-a" }, "three")).toBe(
			reconciled,
		);
		const repeatedNavigation = selectTab(
			reconciled,
			{ area: "center", groupId: "center-a" },
			"three",
			true,
			true,
		);
		expect(repeatedNavigation.navigationClockByGroup["center-a"]).toBe(8);
		const navigated = selectTab(reconciled, { area: "center", groupId: "center-a" }, "one");
		expect(navigated.navigationClockByGroup["center-a"]).toBe(8);
		const passivelySelected = selectTab(
			reconciled,
			{ area: "center", groupId: "center-a" },
			"one",
			false,
		);
		expect(passivelySelected.selectedByGroup["center-a"]).toBe("one");
		expect(passivelySelected.navigationClockByGroup["center-a"]).toBe(7);
	});

	test("attention reconciliation treats opaque group ids as data, not object prototype keys", () => {
		const document = baseDocument([file("one")]);
		document.center.id = "__proto__";
		const reconciled = reconcileAttention(document, undefined);
		expect(Object.getPrototypeOf(reconciled.selectedByGroup)).toBeNull();
		expect(Object.getPrototypeOf(reconciled.lastFocusedSideGroupId)).toBeNull();
		expect(Object.getPrototypeOf(reconciled.navigationClockByGroup)).toBeNull();
		expect(Object.getOwnPropertyDescriptor(reconciled.selectedByGroup, "__proto__")?.value).toBe(
			"one",
		);
		expect(Object.hasOwn(reconciled.selectedByGroup, "__proto__")).toBe(true);

		const constructorDocument = baseDocument([file("one")]);
		constructorDocument.center.id = "constructor";
		const fromUntrustedPlainObjects = reconcileAttention(constructorDocument, {
			selectedByGroup: {},
			lastFocusedCenterGroupId: "constructor",
			lastFocusedSideGroupId: {},
			navigationClockByGroup: {},
		});
		expect(fromUntrustedPlainObjects.selectedByGroup.constructor).toBe("one");
		expect(fromUntrustedPlainObjects.navigationClockByGroup.constructor).toBe(0);
	});

	test("session pruning removes both chat and registered TODO references without touching neighbors", () => {
		const document = baseDocument([
			file("one"),
			{ kind: "chat", id: "chat", name: "Chat", sessionId: "session" },
			{
				kind: "document",
				id: "todo",
				name: "TODO",
				documentKind: "todo-plan",
				sourceId: "session",
				docPath: "TODO.md",
			},
		]);
		const pruned = removeSessionLayoutTabs(document, "session");
		expect(collectCenterGroups(pruned.center).flatMap((group) => group.tabs)).toEqual([
			file("one"),
		]);
	});

	test("preset application preserves resources and falls terminals back to center when sides are empty", () => {
		const terminal: LayoutTerminalTab = {
			kind: "terminal",
			id: "terminal:t1",
			name: "Terminal 1",
			tabKey: "t1",
		};
		const sourceDocument = baseDocument([file("one")]);
		const sourceFilesGroup = sourceDocument.right.groups[0];
		if (!sourceFilesGroup) throw new Error("missing source tool group fixture");
		sourceDocument.right.groups[0] = {
			...sourceFilesGroup,
			tabs: [{ ...toolTab("files"), id: "legacy-files-placement" }],
		};
		const source = mutation(
			moveTabToGroup(sourceDocument, terminal, {
				area: "right",
				groupId: "right-a",
			}),
		).document;
		const emptyPreset = {
			id: "empty-sides",
			name: "Empty sides",
			center: { kind: "group" as const, id: "only" },
			left: { visible: false, width: 0.2, groups: [] },
			right: { visible: false, width: 0.2, groups: [] },
		};
		const seeded = instantiateLayoutPreset({
			...emptyPreset,
			center: { kind: "group", id: "x".repeat(200) },
		});
		expect(seeded.center.id.length).toBeLessThanOrEqual(200);
		expect(validateLayoutDocument(seeded, 6)).toEqual([]);
		expect(canShowSide(seeded, "left")).toBe(true);
		expect(canShowSide(seeded, "right")).toBe(true);
		const applied = applyLayoutPreset(source, emptyPreset);
		expect(validateLayoutDocument(applied, 6)).toEqual([]);
		expect(
			collectCenterGroups(applied.center)[0]
				?.tabs.map((tab) => tab.id)
				.sort(),
		).toEqual(["one", "terminal:t1"]);
		expect(applied.toolRestoreTargets).toEqual({
			projects: { side: "left", index: 0 },
			specs: { side: "right", index: 0 },
			files: { side: "right", index: 0 },
			changes: { side: "right", index: 2 },
			review: { side: "right", index: 3 },
		});
		expect(canShowSide(applied, "left")).toBe(true);
		expect(
			findTabLocation(mutation(revealTool(applied, "projects", 6)).document, "tool:projects"),
		).toMatchObject({ area: "left" });

		const focus = BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === "focus");
		if (!focus) throw new Error("missing Focus preset");
		const focused = applyLayoutPreset(source, focus);
		expect(focused.left.visible).toBe(false);
		expect(focused.right.visible).toBe(false);
		expect(
			focused.right.groups.flatMap((group) => group.tabs).some((tab) => tab.id === "terminal:t1"),
		).toBe(true);
		expect(
			focused.right.groups
				.flatMap((group) => group.tabs)
				.find((tab) => tab.kind === "tool" && tab.tool === "files")?.id,
		).toBe("legacy-files-placement");

		const balanced = BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === "balanced");
		if (!balanced) throw new Error("missing Balanced preset");
		const collidingTerminal: LayoutTerminalTab = {
			kind: "terminal",
			id: "tool:review",
			name: "Terminal",
			tabKey: "collision",
		};
		const collisionApplied = applyLayoutPreset(baseDocument([collidingTerminal]), balanced);
		expect(validateLayoutDocument(collisionApplied, 6)).toEqual([]);
		expect(
			collisionApplied.right.groups
				.flatMap((group) => group.tabs)
				.find((tab) => tab.kind === "tool" && tab.tool === "review")?.id,
		).not.toBe("tool:review");
	});

	test("portable capture drops terminal-only groups without leaving an impossible visible side", () => {
		const terminalOnly = baseDocument();
		terminalOnly.right.groups = [
			{
				id: "terminal-only",
				weight: 1,
				folded: false,
				tabs: [{ kind: "terminal", id: "terminal:t1", name: "Terminal", tabKey: "t1" }],
			},
		];
		const preset = captureLayoutPreset(terminalOnly, "portable", "Portable");
		expect(preset.right).toEqual({ visible: false, width: 0.28, groups: [] });

		terminalOnly.right.groups.unshift({
			id: "tool-group",
			weight: 0.25,
			folded: false,
			tabs: [toolTab("files")],
		});
		const terminalGroup = terminalOnly.right.groups[1];
		if (!terminalGroup) throw new Error("missing terminal-only group fixture");
		terminalOnly.right.groups[1] = { ...terminalGroup, weight: 0.75 };
		const mixed = captureLayoutPreset(terminalOnly, "mixed", "Mixed");
		expect(mixed.right.groups[0]?.weight).toBe(1);
	});

	test("successful generated mutation sequences preserve every layout invariant", () => {
		const directions = ["left", "right", "up", "down"] as const;
		const tools = ["projects", "specs", "files", "changes", "review"] as const;
		for (const initialSeed of [1, 7, 29, 97, 313]) {
			let seed = initialSeed;
			const random = () => {
				seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
				return seed;
			};
			const pick = <T>(values: readonly T[]): T | undefined => values[random() % values.length];
			const terminal: LayoutTerminalTab = {
				kind: "terminal",
				id: `terminal:${initialSeed}`,
				name: `Terminal ${initialSeed}`,
				tabKey: `t${initialSeed}`,
			};
			let document = baseDocument([file(`seed-${initialSeed}`), terminal]);
			let fileNumber = 0;

			for (let step = 0; step < 120; step += 1) {
				const centerGroups = collectCenterGroups(document.center);
				const allGroups = collectAllGroups(document);
				const allTabs = allGroups.flatMap((group) => group.tabs);
				let result: LayoutOperationResult;
				switch (random() % 8) {
					case 0: {
						const group = pick(centerGroups);
						if (!group) continue;
						result = openCenterTab(
							document,
							file(`generated-${initialSeed}-${fileNumber++}`),
							group.id,
							random() % 2 === 0 ? "preview" : "keep",
						);
						break;
					}
					case 1: {
						const group = pick(centerGroups);
						const direction = pick(directions);
						const tab = group ? pick(group.tabs) : undefined;
						if (!group || !direction || !tab) continue;
						result = splitCenterGroup(document, group.id, direction, tab);
						break;
					}
					case 2: {
						const tab = pick(allTabs);
						const targets = allGroups.filter(
							(group) => tab?.kind !== "tool" || group.location.area !== "center",
						);
						const target = pick(targets);
						if (!tab || !target) continue;
						result = moveTabToGroup(document, tab, target.location, random() % 4);
						break;
					}
					case 3: {
						const tab = pick(centerGroups.flatMap((group) => group.tabs));
						if (!tab) continue;
						result = closeLayoutTab(document, tab.id);
						break;
					}
					case 4: {
						const tab = pick(allTabs.filter((candidate) => candidate.kind !== "file"));
						const side = random() % 2 === 0 ? "left" : "right";
						if (!tab || (tab.kind !== "tool" && tab.kind !== "terminal")) continue;
						result = createSideGroup(document, side, tab, random() % 8, 6);
						break;
					}
					case 5: {
						const side = random() % 2 === 0 ? "left" : "right";
						const group = pick(document[side].groups);
						if (!group) continue;
						result = setSideGroupFolded(document, side, group.id, !group.folded);
						break;
					}
					case 6: {
						const tool = pick(tools);
						if (!tool) continue;
						result = revealTool(document, tool, 6);
						break;
					}
					default: {
						const side = random() % 2 === 0 ? "left" : "right";
						result = setSideVisibility(document, side, !document[side].visible);
					}
				}
				if (!isLayoutUnavailable(result)) document = result.document;
				expect(validateLayoutDocument(document, 6)).toEqual([]);
			}
		}
	});

	test("validator catches duplicate placement and illegal side content", () => {
		const document = baseDocument([file("one")]);
		document.right.groups[0]?.tabs.push({
			kind: "terminal",
			id: "one",
			name: "duplicate",
			tabKey: "t1",
		});
		document.left.groups[0]?.tabs.push({
			kind: "terminal",
			id: "terminal:alias",
			name: "canonical duplicate",
			tabKey: "t1",
		});
		const errors = validateLayoutDocument(document, 6);
		expect(errors).toContain("Duplicate tab placement: one");
		expect(errors).toContain("Duplicate canonical resource: terminal");
		expect(collectAllGroups(document)).toHaveLength(3);
	});
});
