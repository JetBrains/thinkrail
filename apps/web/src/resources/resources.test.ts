import { afterEach, expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import {
	anchorLabel,
	describeResource,
	isPlaceable,
	type ResourceDescriptor,
	type ResourceRenderer,
	registerResourceRenderer,
	resolveRenderers,
} from "./index";

const disposers: Array<() => void> = [];

afterEach(() => {
	for (const dispose of disposers.splice(0).reverse()) dispose();
});

function renderer(id: string, overrides: Partial<ResourceRenderer> = {}): ResourceRenderer {
	return {
		id,
		label: id,
		match: {},
		rank: 0,
		capabilities: {
			view: true,
			diff: true,
			anchors: { view: [], diff: [] },
			mobile: true,
			active: false,
		},
		trust: "bundled",
		...overrides,
	};
}

function register(value: ResourceRenderer): void {
	disposers.push(registerResourceRenderer(value));
}

function registerFallbacks(): void {
	register(
		renderer("thinkrail/code", {
			label: "Source",
			match: { text: true },
			rank: 100,
			capabilities: {
				view: true,
				diff: true,
				anchors: { view: ["line"], diff: ["line"] },
				mobile: true,
				active: false,
			},
		}),
	);
	register(
		renderer("thinkrail/binary", {
			label: "File",
			match: { text: false },
		}),
	);
}

const markdown: ResourceDescriptor = {
	workspaceId: "ws",
	path: "docs/README.md",
	mime: "text/markdown",
	language: "markdown",
	text: true,
	byteLength: 12,
};

test("resolution filters matches, orders richer renderers by rank, and appends the text fallback", () => {
	registerFallbacks();
	register(renderer("example/low", { match: { glob: ["*.md"] }, rank: 120 }));
	register(renderer("example/high", { match: { mime: ["text/*"] }, rank: 220 }));
	register(renderer("example/json", { match: { language: ["json"] }, rank: 300 }));

	expect(resolveRenderers(markdown, "view", { mobile: false }).map((item) => item.id)).toEqual([
		"example/high",
		"example/low",
		"thinkrail/code",
	]);
});

test("resolution filters view and diff capabilities independently", () => {
	registerFallbacks();
	register(
		renderer("example/view", {
			match: { glob: ["*.md"] },
			rank: 200,
			capabilities: {
				view: true,
				diff: false,
				anchors: { view: ["line"], diff: [] },
				mobile: true,
				active: false,
			},
		}),
	);
	register(
		renderer("example/diff", {
			match: { glob: ["*.md"] },
			rank: 200,
			capabilities: {
				view: false,
				diff: true,
				anchors: { view: [], diff: ["line"] },
				mobile: true,
				active: false,
			},
		}),
	);

	expect(resolveRenderers(markdown, "view", { mobile: false }).map((item) => item.id)).toEqual([
		"example/view",
		"thinkrail/code",
	]);
	expect(resolveRenderers(markdown, "diff", { mobile: false }).map((item) => item.id)).toEqual([
		"example/diff",
		"thinkrail/code",
	]);
});

test("mobile resolution is a hard capability filter", () => {
	registerFallbacks();
	register(
		renderer("example/desktop", {
			match: { glob: ["*.md"] },
			rank: 200,
			capabilities: {
				view: true,
				diff: true,
				anchors: { view: ["line"], diff: ["line"] },
				mobile: false,
				active: false,
			},
		}),
	);

	expect(resolveRenderers(markdown, "view", { mobile: true }).map((item) => item.id)).toEqual([
		"thinkrail/code",
	]);
});

test("text and byte resources always resolve to their registered fallback", () => {
	registerFallbacks();
	expect(resolveRenderers(markdown, "diff", { mobile: false }).at(-1)?.id).toBe("thinkrail/code");
	expect(
		resolveRenderers({ workspaceId: "ws", path: "asset.bin", text: false, byteLength: 4 }, "view", {
			mobile: false,
		}).map((item) => item.id),
	).toEqual(["thinkrail/binary"]);
});

test("a missing fallback fails with the renderer id and intent", () => {
	expect(() => resolveRenderers(markdown, "view", { mobile: false })).toThrow(
		"thinkrail/code (view)",
	);
});

test("anchor labels cover line ranges, structural references, regions, and whole files", () => {
	const anchor = (selectors: ReviewAnchor["selectors"]): ReviewAnchor => ({
		path: "file",
		side: "worktree",
		selectors,
	});
	expect(anchorLabel(anchor([{ kind: "lineRange", startLine: 3, endLine: 3 }]))).toBe("L3");
	expect(anchorLabel(anchor([{ kind: "lineRange", startLine: 3, endLine: 7 }]))).toBe("L3–7");
	expect(anchorLabel(anchor([{ kind: "structural", scheme: "ipynb-cell", ref: "cell-7" }]))).toBe(
		"ipynb-cell cell-7",
	);
	expect(anchorLabel(anchor([{ kind: "region", x: 0, y: 0, width: 1, height: 1 }]))).toBe("region");
	expect(anchorLabel(anchor([]))).toBe("file");
});

test("resource descriptions derive language and mime without overriding host metadata", () => {
	expect(
		describeResource(
			"ws",
			"src/view.TSX",
			{ hash: "hash", byteLength: 42, text: true },
			{ kind: "uncommitted" },
		),
	).toEqual({
		workspaceId: "ws",
		path: "src/view.TSX",
		mime: "text/typescript",
		language: "tsx",
		text: true,
		byteLength: 42,
		scope: { kind: "uncommitted" },
	});
	expect(
		describeResource("ws", "asset.png", {
			hash: "hash",
			byteLength: 10,
			text: false,
			mime: "application/custom",
		}),
	).toMatchObject({ mime: "application/custom", text: false });
});

test("placement uses anchor capabilities for the requested intent", () => {
	const source = renderer("example/source", {
		capabilities: {
			view: true,
			diff: true,
			anchors: { view: ["line"], diff: ["structural:json-pointer"] },
			mobile: true,
			active: false,
		},
	});
	const line: ReviewAnchor = {
		path: "a.json",
		side: "worktree",
		selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
	};
	const structural: ReviewAnchor = {
		path: "a.json",
		side: "worktree",
		selectors: [{ kind: "structural", scheme: "json-pointer", ref: "/name" }],
	};

	expect(isPlaceable(source, "view", line)).toBe(true);
	expect(isPlaceable(source, "diff", line)).toBe(false);
	expect(isPlaceable(source, "view", structural)).toBe(false);
	expect(isPlaceable(source, "diff", structural)).toBe(true);
});
