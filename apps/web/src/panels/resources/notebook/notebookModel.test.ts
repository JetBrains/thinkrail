import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import { anchorLabel } from "@/resources";
import {
	alignNotebookCells,
	notebookCellDraft,
	notebookCellOfAnchor,
	parseNotebook,
	selectNotebookMime,
	stripAnsi,
} from "./notebookModel";

const NOTEBOOK = `{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": { "kernelspec": { "language": "python" } },
  "cells": [
    {
      "cell_type": "markdown",
      "id": "intro",
      "metadata": {},
      "source": ["# Heading\\n", "Body"]
    },
    {
      "cell_type": "code",
      "id": "run",
      "metadata": {},
      "execution_count": 2,
      "source": ["print(1)\\n"],
      "outputs": [{ "output_type": "stream", "text": "\\u001b[31mred\\u001b[0m\\n" }]
    }
  ]
}`;

test("notebook parser records raw cell-object ranges, ids, source, language, and outputs", () => {
	const notebook = parseNotebook(NOTEBOOK);
	expect(notebook?.language).toBe("python");
	expect(notebook?.cells).toHaveLength(2);
	expect(notebook?.cells[0]).toMatchObject({
		index: 0,
		id: "intro",
		ref: "intro",
		type: "markdown",
		source: "# Heading\nBody",
		startLine: 6,
		endLine: 11,
	});
	expect(notebook?.cells[1]).toMatchObject({
		index: 1,
		ref: "run",
		startLine: 12,
		endLine: 19,
		executionCount: 2,
		outputs: [{ kind: "text", outputType: "stream", text: "red\n" }],
	});
});

test("notebook language metadata is canonicalized and unsafe identifiers become plain text", () => {
	const notebookWith = (metadata: unknown) =>
		parseNotebook(
			JSON.stringify({
				nbformat: 4,
				nbformat_minor: 5,
				metadata,
				cells: [],
			}),
		);
	expect(notebookWith({ language_info: { name: "C++" } })?.language).toBe("cpp");
	expect(
		notebookWith({ kernelspec: { language: "python\n```\n![x](https://attacker.invalid)" } })
			?.language,
	).toBe("");
	expect(notebookWith({})?.language).toBe("python");
});

test("pre-4.5 notebooks use index refs and cell drafts carry both mandatory selectors", () => {
	const notebook = parseNotebook(
		JSON.stringify({
			nbformat: 4,
			nbformat_minor: 4,
			metadata: {},
			cells: [{ cell_type: "markdown", id: "ignored", metadata: {}, source: ["hello"] }],
		}),
	);
	const cell = notebook?.cells[0];
	expect(cell?.ref).toBe("index:0");
	if (!cell) throw new Error("Expected parsed cell");
	expect(notebookCellDraft(cell)).toEqual({
		selectors: [
			{ kind: "lineRange", startLine: 1, endLine: 1 },
			{ kind: "structural", scheme: "ipynb-cell", ref: "index:0" },
		],
		label: "cell 1",
	});
});

test("cell anchors resolve ids and legacy indexes but reject a disjoint host line range", () => {
	const notebook = parseNotebook(NOTEBOOK);
	if (!notebook) throw new Error("Expected parsed notebook");
	const anchor = (ref: string, startLine: number, endLine: number): ReviewAnchor => ({
		path: "analysis.ipynb",
		side: "worktree",
		selectors: [
			{ kind: "lineRange", startLine, endLine },
			{ kind: "structural", scheme: "ipynb-cell", ref },
		],
	});
	expect(notebookCellOfAnchor(anchor("intro", 6, 11), notebook)?.index).toBe(0);
	expect(notebookCellOfAnchor(anchor("index:1", 12, 20), notebook)?.id).toBe("run");
	expect(notebookCellOfAnchor(anchor("intro", 30, 31), notebook)).toBeNull();
	expect(anchorLabel(anchor("intro", 6, 11), notebook.cellOrdinals)).toBe("cell 1");
});

test("mime selection follows notebook display preference", () => {
	expect(
		selectNotebookMime({
			"text/plain": "plain",
			"application/json": { fallback: true },
			"text/html": "<b>html</b>",
			"image/svg+xml": "<svg></svg>",
			"image/png": "png-data",
		}),
	).toEqual({ kind: "image", mime: "image/png", data: "png-data" });
	expect(selectNotebookMime({ "text/html": ["<b>", "html</b>"], "text/plain": "plain" })).toEqual({
		kind: "html",
		html: "<b>html</b>",
	});
	expect(selectNotebookMime({ "application/json": { ok: true }, "text/plain": "plain" })).toEqual({
		kind: "json",
		value: { ok: true },
	});
	expect(selectNotebookMime({ "text/plain": ["a", "b"] })).toEqual({
		kind: "text",
		outputType: "text/plain",
		text: "ab",
	});
});

test("ANSI stripping removes CSI and OSC escapes from streams and tracebacks", () => {
	expect(stripAnsi("a\u001b[31mred\u001b[0m b")).toBe("ared b");
	expect(stripAnsi("before\u001b]0;title\u0007after")).toBe("beforeafter");
	const notebook = parseNotebook(
		JSON.stringify({
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: [
				{
					cell_type: "code",
					id: "error",
					metadata: {},
					source: ["raise ValueError()"],
					execution_count: 1,
					outputs: [
						{
							output_type: "error",
							ename: "ValueError",
							evalue: "bad",
							traceback: ["\u001b[31mTraceback\u001b[0m", "ValueError: bad"],
						},
					],
				},
			],
		}),
	);
	expect(notebook?.cells[0]?.outputs).toEqual([
		{ kind: "error", text: "Traceback\nValueError: bad" },
	]);
});

function parsedCells(cells: unknown[], minor = 5) {
	const parsed = parseNotebook(
		JSON.stringify({ nbformat: 4, nbformat_minor: minor, metadata: {}, cells }),
	);
	if (!parsed) throw new Error("Expected notebook cells");
	return parsed.cells;
}

test("cell alignment prefers ids, then exact source, then source similarity", () => {
	const original = parsedCells([
		{ cell_type: "code", id: "stable", metadata: {}, source: ["print(1)"], outputs: [] },
		{ cell_type: "markdown", metadata: {}, source: ["same source"] },
		{
			cell_type: "code",
			metadata: {},
			source: ["total = value + 1\n", "print(total)"],
			outputs: [],
		},
	]);
	const modified = parsedCells([
		{ cell_type: "code", id: "stable", metadata: {}, source: ["print(2)"], outputs: [] },
		{ cell_type: "markdown", metadata: {}, source: ["same source"] },
		{
			cell_type: "code",
			metadata: {},
			source: ["total = value + 2\n", "print(total)"],
			outputs: [],
		},
	]);
	const aligned = alignNotebookCells(original, modified);
	expect(aligned.map((entry) => entry.state)).toEqual(["changed", "unchanged", "changed"]);
	if (aligned[0]?.state === "changed") expect(aligned[0].original.id).toBe("stable");
	if (aligned[1]?.state === "unchanged") expect(aligned[1].original.source).toBe("same source");
	if (aligned[2]?.state === "changed") expect(aligned[2].original.source).toContain("+ 1");
});

test("order-aware similarity keeps an early ambiguous cell from taking a later cell's match", () => {
	const original = parsedCells(
		[
			{ cell_type: "code", metadata: {}, source: ["common\n", "left"], outputs: [] },
			{
				cell_type: "code",
				metadata: {},
				source: ["common\n", "right\n", "extra"],
				outputs: [],
			},
		],
		4,
	);
	const modified = parsedCells(
		[
			{
				cell_type: "code",
				metadata: {},
				source: ["common\n", "left\n", "right\n", "extra"],
				outputs: [],
			},
			{
				cell_type: "code",
				metadata: {},
				source: ["common\n", "right\n", "changed"],
				outputs: [],
			},
		],
		4,
	);
	const aligned = alignNotebookCells(original, modified);
	expect(aligned.map((entry) => entry.state)).toEqual(["changed", "changed"]);
	if (aligned[0]?.state === "changed") expect(aligned[0].original.source).toContain("left");
	if (aligned[1]?.state === "changed") expect(aligned[1].original.source).toContain("right");
});

test("200 disjoint notebook cells align within the bounded similarity budget", () => {
	const cells = (prefix: string) =>
		Array.from({ length: 200 }, (_value, index) => ({
			cell_type: "code",
			metadata: {},
			source: [`${prefix}-${String(index).padStart(3, "0")}-${"x".repeat(94)}`],
			outputs: [],
		}));
	const original = parsedCells(cells("original"), 4);
	const modified = parsedCells(cells("modified"), 4);
	const started = performance.now();
	const aligned = alignNotebookCells(original, modified);
	const elapsed = performance.now() - started;
	expect(aligned).toHaveLength(400);
	expect(elapsed).toBeLessThan(200);
});
