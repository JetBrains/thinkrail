import { describe, expect, test } from "bun:test";
import { assignChord, keybindingList, matchLocal, planImport, resolveKeybindings } from ".";

type Overrides = Record<string, string[]>;

const resolved = (overrides: Overrides) =>
	resolveKeybindings({ platform: "Linux x86_64", overrides });

const list = (overrides: Overrides) =>
	keybindingList({ desktop: false, keybindings: resolved(overrides), extensions: [] });

const file = (bindings: unknown[]) => ({ format: "thinkrail-keybindings", version: 1, bindings });

const actsOn = (overrides: Overrides, scope: string, code: string) =>
	matchLocal(resolved(overrides), [scope], {
		code,
		key: "",
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
	});

const OTHER_ELEMENTS = ["tabs", "rails", "review.surface", "transcript"];

describe("a customised shared twin holding a command's own default", () => {
	const overrides = { "arrows.down": ["KeyS"], "trees.search": ["KeyG"] };

	const expectSearchWinsInTreesOnly = (next: Overrides) => {
		expect(actsOn(next, "trees", "KeyS")).toBe("trees.search");
		expect(actsOn(next, "trees", "KeyG")).toBeNull();
		for (const scope of OTHER_ELEMENTS) expect(actsOn(next, scope, "KeyS")).toBe("arrows.down");
		expect(resolved(next).byId.get("arrows.down")?.chords).toEqual([
			expect.objectContaining({
				text: "KeyS",
				lostTo: null,
				lostIn: [{ scope: "trees", winner: "trees.search" }],
			}),
		]);
	};

	test("Replace keeps the default as an explicit override, so it beats the twin inside that element", () => {
		const next = assignChord(list(overrides), overrides, "trees.search", "KeyS", true);
		expectSearchWinsInTreesOnly(next);
		expect(next).toEqual({ "arrows.down": ["KeyS"], "trees.search": ["KeyS"] });
	});

	test("an import of the default does the same", () => {
		const plan = planImport(
			overrides,
			list(overrides),
			file([{ command: "trees.search", chords: ["KeyS"] }]),
		);
		expectSearchWinsInTreesOnly(plan?.overrides ?? {});
		expect(plan?.conflicts).toEqual([
			{ chord: "S", command: "trees.search", other: "arrows.down", scope: "trees" },
		]);
		expect(plan?.overrides).toEqual({ "arrows.down": ["KeyS"], "trees.search": ["KeyS"] });
	});
});

describe("a key for a shared twin held in several elements", () => {
	const overrides = { "trees.search": ["KeyX"], "transcript.copy": ["KeyX"] };

	const expectDownEverywhere = (next: Overrides) => {
		expect(actsOn(next, "transcript", "KeyX")).toBe("arrows.down");
		expect(actsOn(next, "trees", "KeyX")).toBe("arrows.down");
		expect(next).toEqual({ "arrows.down": ["KeyX"], "trees.search": [], "transcript.copy": [] });
	};

	test("Replace takes it from every holder", () => {
		expectDownEverywhere(assignChord(list(overrides), overrides, "arrows.down", "KeyX", true));
	});

	test("an import reports and replaces every holder", () => {
		const plan = planImport(
			overrides,
			list(overrides),
			file([{ command: "trees.down", alias: "arrows.down", chords: ["KeyX"] }]),
		);
		expect(plan?.conflicts).toEqual([
			{ chord: "X", command: "arrows.down", other: "trees.search", scope: "trees" },
			{ chord: "X", command: "arrows.down", other: "transcript.copy", scope: "transcript" },
		]);
		expectDownEverywhere(plan?.overrides ?? {});
	});
});
