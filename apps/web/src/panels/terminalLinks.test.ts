import { describe, expect, test } from "bun:test";
import type { TerminalPathTarget } from "@thinkrail/contracts";
import type { ILink } from "@xterm/xterm";
import { parseTerminalLinks } from "./terminalLinkParse";
import {
	createTerminalLinkProvider,
	readLogicalLine,
	type TerminalBufferLike,
	type TerminalLineLike,
	type TerminalLinkTarget,
} from "./terminalLinks";

const COLS = 20;

function row(text: string, isWrapped = false, cols = COLS): TerminalLineLike {
	const cells: { chars: string; width: number }[] = [];
	for (const char of text) {
		const wide = /[　-鿿]/.test(char);
		cells.push({ chars: char, width: wide ? 2 : 1 });
		if (wide) cells.push({ chars: "", width: 0 });
	}
	// Cells never written read as empty, the way xterm reports them.
	while (cells.length < cols) cells.push({ chars: "", width: 1 });
	return {
		isWrapped,
		length: cols,
		getCell: (x) => {
			const cell = cells[x];
			return cell ? { getChars: () => cell.chars, getWidth: () => cell.width } : undefined;
		},
	};
}

function buffer(...rows: TerminalLineLike[]): TerminalBufferLike {
	return { length: rows.length, getLine: (y) => rows[y] };
}

const exists = (relPath: string): TerminalPathTarget => ({ kind: "file", relPath });
const folder = (relPath: string): TerminalPathTarget => ({ kind: "dir", relPath });
const missing: TerminalPathTarget = { kind: null, relPath: null };

function harness(
	rows: TerminalLineLike[],
	answer: (candidate: string) => TerminalPathTarget = () => missing,
) {
	const asked: string[][] = [];
	const opened: TerminalLinkTarget[] = [];
	const hints: boolean[] = [];
	let now = 0;
	let resolveImpl = (candidates: string[]) => Promise.resolve(candidates.map(answer));
	const provider = createTerminalLinkProvider({
		buffer: () => buffer(...rows),
		resolve: (candidates) => {
			asked.push(candidates);
			return resolveImpl(candidates);
		},
		open: (target) => opened.push(target),
		isActivation: (event) => event.metaKey,
		showHint: (visible) => hints.push(visible),
		now: () => now,
	});
	const linksAt = (y: number) =>
		new Promise<ILink[] | undefined>((resolve) => provider.provideLinks(y, resolve));
	return {
		provider,
		asked,
		opened,
		hints,
		linksAt,
		advance: (ms: number) => {
			now += ms;
		},
		setResolve: (next: typeof resolveImpl) => {
			resolveImpl = next;
		},
	};
}

const click = (metaKey: boolean) => ({ metaKey }) as MouseEvent;
const urls = (line: string) =>
	parseTerminalLinks(line).flatMap((link) => (link.kind === "url" ? [link.url] : []));

describe("readLogicalLine", () => {
	test("joins soft-wrapped rows from any of them", () => {
		const rows = [
			row("before"),
			row("https://example.com/"),
			row("docs/intro", true),
			row("after"),
		];
		const fromFirst = readLogicalLine(buffer(...rows), 1);
		const fromSecond = readLogicalLine(buffer(...rows), 2);
		expect(fromFirst?.text).toBe("https://example.com/docs/intro");
		expect(fromSecond?.text).toBe(fromFirst?.text);
		expect(fromFirst?.cells[19]).toEqual({ x: 19, y: 1, width: 1 });
		expect(fromFirst?.cells[20]).toEqual({ x: 0, y: 2, width: 1 });
	});

	test("keeps a wrapped row's printed spaces but trims the end of the line", () => {
		const rows = [row("a b                 ".slice(0, COLS)), row("c   ", true)];
		expect(readLogicalLine(buffer(...rows), 0)?.text).toBe(`a b${" ".repeat(17)}c`);
	});

	test("maps a wide character to its first cell and skips its spacer", () => {
		const line = readLogicalLine(buffer(row("日本/a")), 0);
		expect(line?.text).toBe("日本/a");
		expect(line?.cells.map((cell) => cell.x)).toEqual([0, 2, 4, 5]);
		expect(line?.cells[0]?.width).toBe(2);
	});

	test("the empty cell xterm leaves before a wide character it wrapped is not a space", () => {
		// 9 printed columns, then a wide character that no longer fits: xterm leaves column 10 empty
		// and starts the next row with it.
		const rows = [row("https://a", false, 10), row("日本/x", true, 10)];
		const line = readLogicalLine(buffer(...rows), 0);
		expect(line?.text).toBe("https://a日本/x");
		expect(line?.cells[9]).toEqual({ x: 0, y: 1, width: 2 });
		expect(urls(line?.text ?? "")).toEqual(["https://a日本/x"]);
	});

	test("a row outside the buffer has no line", () => {
		expect(readLogicalLine(buffer(row("x")), 5)).toBeNull();
	});
});

describe("createTerminalLinkProvider", () => {
	test("a URL becomes an underlined link over its cells without asking the host", async () => {
		const h = harness([row("see https://x.dev/a")]);
		const links = await h.linksAt(1);
		expect(links?.map((link) => link.text)).toEqual(["https://x.dev/a"]);
		expect(links?.[0]?.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 19, y: 1 } });
		expect(links?.[0]?.decorations).toEqual({ pointerCursor: true, underline: true });
		expect(h.asked).toEqual([]);
	});

	test("a line with nothing link-shaped answers with no links and no request", async () => {
		const h = harness([row("hello world")]);
		expect(await h.linksAt(1)).toBeUndefined();
		expect(await harness([row("x")]).linksAt(9)).toBeUndefined();
		expect(h.asked).toEqual([]);
	});

	test("a URL wrapped across rows spans both and is found from either", async () => {
		const rows = [row("https://example.com/"), row("docs ok", true)];
		const h = harness(rows);
		const expected = { start: { x: 1, y: 1 }, end: { x: 4, y: 2 } };
		expect((await h.linksAt(1))?.[0]?.range).toEqual(expected);
		expect((await h.linksAt(2))?.[0]?.range).toEqual(expected);
	});

	test("URLs on other rows of a wrapped line are not offered", async () => {
		const rows = [row("https://a.dev xxxxx "), row("https://b.dev", true)];
		const links = await harness(rows).linksAt(2);
		expect(links?.map((link) => link.text)).toEqual(["https://b.dev"]);
	});

	test("activation needs the platform modifier", async () => {
		const h = harness([row("docs https://x.dev")]);
		const [link] = (await h.linksAt(1)) ?? [];
		link?.activate(click(false), link.text);
		expect(h.opened).toEqual([]);
		link?.activate(click(true), link.text);
		expect(h.opened).toEqual([{ kind: "url", url: "https://x.dev" }]);
	});

	test("hovering shows the hint and leaving hides it", async () => {
		const h = harness([row("https://x.dev")]);
		const [link] = (await h.linksAt(1)) ?? [];
		link?.hover?.(click(false), link.text);
		link?.leave?.(click(false), link.text);
		expect(h.hints).toEqual([true, false]);
	});

	test("only paths the host confirms become links, asked in one batch per line", async () => {
		const h = harness([row("a.ts:3 b.ts a.ts")], (candidate) =>
			candidate === "a.ts" ? exists("src/a.ts") : missing,
		);
		const links = await h.linksAt(1);
		expect(h.asked).toEqual([["a.ts", "b.ts"]]);
		expect(links?.map((link) => link.text)).toEqual(["a.ts:3", "a.ts"]);
		expect(links?.[0]?.decorations).toEqual({ pointerCursor: true, underline: true });
	});

	test("a candidate the host would refuse as too long is never sent", async () => {
		const long = `x/${"a".repeat(5_000)}.ts`;
		const h = harness([row(`${long} b.ts`, false, long.length + 10)], () => exists("b.ts"));
		const links = await h.linksAt(1);
		expect(h.asked).toEqual([["b.ts"]]);
		expect(links?.map((link) => link.text)).toEqual(["b.ts"]);
	});

	test("at most the host's candidate limit is asked for one line", async () => {
		const names = Array.from({ length: 70 }, (_, index) => `f${index}.ts`).join(" ");
		const h = harness([row(names, false, names.length)], (candidate) => exists(candidate));
		await h.linksAt(1);
		expect(h.asked).toHaveLength(1);
		expect(h.asked[0]).toHaveLength(64);
	});

	test("answers are reused for a short while, then asked again", async () => {
		const h = harness([row("a.ts"), row("x a.ts")], () => exists("a.ts"));
		await h.linksAt(1);
		await h.linksAt(2);
		expect(h.asked).toEqual([["a.ts"]]);
		h.advance(2_000);
		await h.linksAt(1);
		expect(h.asked).toEqual([["a.ts"], ["a.ts"]]);
	});

	test("a path wrapped across rows spans both and is found from either", async () => {
		const rows = [row("src/components/Butto"), row("n.tsx:12:3 ok", true)];
		const h = harness(rows, () => exists("src/components/Button.tsx"));
		const expected = { start: { x: 1, y: 1 }, end: { x: 10, y: 2 } };
		expect((await h.linksAt(1))?.[0]?.range).toEqual(expected);
		expect((await h.linksAt(2))?.[0]?.range).toEqual(expected);
	});

	test("overlapping candidates keep the longest that exists", async () => {
		const line = [row('"my dir/f.ts":3')];
		const both = harness(line, (candidate) =>
			candidate === "my dir/f.ts" || candidate === "dir/f.ts" ? exists(candidate) : missing,
		);
		expect((await both.linksAt(1))?.map((link) => link.text)).toEqual(['"my dir/f.ts":3']);
		const innerOnly = harness(line, (candidate) =>
			candidate === "dir/f.ts" ? exists(candidate) : missing,
		);
		expect((await innerOnly.linksAt(1))?.map((link) => link.text)).toEqual(["dir/f.ts"]);
	});

	test("a file opens at its printed line and column, a URL as a URL", async () => {
		const h = harness([row("a.ts:3:2 b.ts docs https://x.dev", false, 40)], (candidate) =>
			candidate === "a.ts" ? exists("src/a.ts") : candidate === "b.ts" ? exists("b.ts") : missing,
		);
		const [file, plain, url] = (await h.linksAt(1)) ?? [];
		file?.activate(click(false), file.text);
		expect(h.opened).toEqual([]);
		file?.activate(click(true), file.text);
		plain?.activate(click(true), plain.text);
		url?.activate(click(true), url.text);
		expect(h.opened).toEqual([
			{ kind: "file", path: "src/a.ts", line: 3, column: 2 },
			{ kind: "file", path: "b.ts" },
			{ kind: "url", url: "https://x.dev" },
		]);
	});

	test("a folder opens as a folder, without a line", async () => {
		const h = harness([row("src/")], () => folder("src"));
		const links = await h.linksAt(1);
		links?.[0]?.activate(click(true), "src/");
		expect(h.opened).toEqual([{ kind: "dir", path: "src" }]);
	});

	test("a host that cannot answer leaves only URLs", async () => {
		const h = harness([row("a.ts https://x.dev")]);
		h.setResolve(() => Promise.reject(new Error("Unknown terminal")));
		expect((await h.linksAt(1))?.map((link) => link.text)).toEqual(["https://x.dev"]);
	});

	test("a superseded ask is never answered", async () => {
		const h = harness([row("a.ts"), row("b.ts")], (candidate) => exists(candidate));
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.setResolve(async (candidates) => {
			await gate;
			return candidates.map((candidate) => exists(candidate));
		});
		const answers: string[] = [];
		h.provider.provideLinks(1, () => answers.push("first"));
		const second = new Promise<void>((resolve) =>
			h.provider.provideLinks(2, () => {
				answers.push("second");
				resolve();
			}),
		);
		release();
		await second;
		await Bun.sleep(0);
		expect(answers).toEqual(["second"]);
	});
});
