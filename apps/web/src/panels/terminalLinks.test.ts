import { describe, expect, test } from "bun:test";
import type { ILink } from "@xterm/xterm";
import {
	createTerminalLinkProvider,
	parseTerminalUrls,
	readLogicalLine,
	type TerminalBufferLike,
	type TerminalLineLike,
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

function harness(rows: TerminalLineLike[]) {
	const opened: string[] = [];
	const hints: boolean[] = [];
	const provider = createTerminalLinkProvider({
		buffer: () => buffer(...rows),
		open: (url) => opened.push(url),
		isActivation: (event) => event.metaKey,
		showHint: (visible) => hints.push(visible),
	});
	const linksAt = (y: number) =>
		new Promise<ILink[] | undefined>((resolve) => provider.provideLinks(y, resolve));
	return { opened, hints, linksAt };
}

const click = (metaKey: boolean) => ({ metaKey }) as MouseEvent;
const urls = (line: string) => parseTerminalUrls(line).map((link) => link.url);

describe("parseTerminalUrls", () => {
	test("http and https, at their positions", () => {
		const line = "Local: http://localhost:5173/ and https://example.com/docs";
		expect(parseTerminalUrls(line)).toEqual([
			{ start: 7, end: 29, url: "http://localhost:5173/" },
			{ start: 34, end: 58, url: "https://example.com/docs" },
		]);
	});

	test("trailing punctuation is trimmed", () => {
		expect(urls("See https://example.com/docs.")).toEqual(["https://example.com/docs"]);
		expect(urls("https://example.com/a, https://example.com/b;")).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
		expect(urls("'https://example.com/x'")).toEqual(["https://example.com/x"]);
		expect(urls("<https://example.com>")).toEqual(["https://example.com"]);
	});

	test("a long run of closers is trimmed in linear time", () => {
		const started = performance.now();
		expect(urls(`https://example.com/a${")".repeat(20_000)}`)).toEqual(["https://example.com/a"]);
		expect(performance.now() - started).toBeLessThan(200);
	});

	test("brackets are kept only when balanced", () => {
		expect(urls("(https://example.com/a_(b))")).toEqual(["https://example.com/a_(b)"]);
		expect(urls("[docs](https://example.com/docs)")).toEqual(["https://example.com/docs"]);
		expect(urls("https://example.com/x),")).toEqual(["https://example.com/x"]);
	});

	test("query strings, fragments and ports stay in", () => {
		expect(urls("https://example.com:8080/q?a=1&b=2#frag")).toEqual([
			"https://example.com:8080/q?a=1&b=2#frag",
		]);
	});

	test("only http(s) links, and a scheme needs a host after its slashes", () => {
		expect(urls("https: https:// https://. ftp://example.com file:///etc/hosts")).toEqual([]);
		expect(urls("nothing here 12:30 v1.2.3")).toEqual([]);
	});
});

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
	test("a URL becomes an underlined link over its cells", async () => {
		const h = harness([row("see https://x.dev/a")]);
		const links = await h.linksAt(1);
		expect(links?.map((link) => link.text)).toEqual(["https://x.dev/a"]);
		expect(links?.[0]?.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 19, y: 1 } });
		expect(links?.[0]?.decorations).toEqual({ pointerCursor: true, underline: true });
	});

	test("a line with no URL answers with no links", async () => {
		expect(await harness([row("hello world")]).linksAt(1)).toBeUndefined();
		expect(await harness([row("x")]).linksAt(9)).toBeUndefined();
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
		expect(h.opened).toEqual(["https://x.dev"]);
	});

	test("hovering shows the hint and leaving hides it", async () => {
		const h = harness([row("https://x.dev")]);
		const [link] = (await h.linksAt(1)) ?? [];
		link?.hover?.(click(false), link.text);
		link?.leave?.(click(false), link.text);
		expect(h.hints).toEqual([true, false]);
	});
});
