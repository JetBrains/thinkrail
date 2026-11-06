import { describe, expect, test } from "bun:test";
import type { TerminalPathTarget } from "@thinkrail/contracts";
import type { ILink } from "@xterm/xterm";
import {
	createTerminalLinkProvider,
	readLogicalLine,
	type TerminalBufferLike,
	type TerminalLineLike,
	type TerminalLinkTarget,
} from "./terminalLinkProvider";

const COLS = 20;

function row(text: string, isWrapped = false, cols = COLS): TerminalLineLike {
	const cells: { chars: string; width: number }[] = [];
	for (const char of text) {
		const wide = /[　-鿿]/.test(char);
		cells.push({ chars: char, width: wide ? 2 : 1 });
		if (wide) cells.push({ chars: "", width: 0 });
	}
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

describe("readLogicalLine", () => {
	test("joins soft-wrapped rows from any of them", () => {
		const rows = [
			row("before"),
			row("src/components/Butto"),
			row("n.tsx:12:3", true),
			row("after"),
		];
		const fromFirst = readLogicalLine(buffer(...rows), 1);
		const fromSecond = readLogicalLine(buffer(...rows), 2);
		expect(fromFirst?.text).toBe("src/components/Button.tsx:12:3");
		expect(fromSecond?.text).toBe(fromFirst?.text);
		expect(fromFirst?.cells[19]).toEqual({ x: 19, y: 1, width: 1 });
		expect(fromFirst?.cells[20]).toEqual({ x: 0, y: 2, width: 1 });
	});

	test("keeps a wrapped row's trailing spaces but trims the end of the line", () => {
		const rows = [row("a b                 ".slice(0, COLS)), row("c.ts   ", true)];
		expect(readLogicalLine(buffer(...rows), 0)?.text).toBe(`a b${" ".repeat(17)}c.ts`);
	});

	test("maps a wide character to its first cell and skips its spacer", () => {
		const line = readLogicalLine(buffer(row("日本/a.md")), 0);
		expect(line?.text).toBe("日本/a.md");
		expect(line?.cells.map((cell) => cell.x)).toEqual([0, 2, 4, 5, 6, 7, 8]);
		expect(line?.cells[0]?.width).toBe(2);
	});

	test("a row outside the buffer has no line", () => {
		expect(readLogicalLine(buffer(row("x")), 5)).toBeNull();
	});
});

describe("createTerminalLinkProvider", () => {
	test("a URL is a link without asking the host", async () => {
		const h = harness([row("see https://x.dev/a")]);
		const links = await h.linksAt(1);
		expect(links?.map((link) => link.text)).toEqual(["https://x.dev/a"]);
		expect(links?.[0]?.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 19, y: 1 } });
		expect(h.asked).toEqual([]);
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

	test("a line with nothing link-shaped answers at once with no links", async () => {
		const h = harness([row("hello world")]);
		expect(await h.linksAt(1)).toBeUndefined();
		expect(h.asked).toEqual([]);
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

	test("a link wrapped across rows spans both and is found from either", async () => {
		const rows = [row("src/components/Butto"), row("n.tsx:12:3 ok", true)];
		const h = harness(rows, () => exists("src/components/Button.tsx"));
		const fromFirst = await h.linksAt(1);
		const fromSecond = await h.linksAt(2);
		const expected = { start: { x: 1, y: 1 }, end: { x: 10, y: 2 } };
		expect(fromFirst?.[0]?.range).toEqual(expected);
		expect(fromSecond?.[0]?.range).toEqual(expected);
	});

	test("links on other rows of a wrapped line are not offered", async () => {
		const rows = [row("a.ts xxxxxxxxxxxxxx "), row("b.ts", true)];
		const h = harness(rows, (candidate) => exists(candidate));
		const links = await h.linksAt(2);
		expect(links?.map((link) => link.text)).toEqual(["b.ts"]);
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

	test("activation needs the platform modifier and opens the resolved target", async () => {
		const h = harness([row("a.ts:3:2 docs https://x.dev", false, 40)], (candidate) =>
			candidate === "a.ts" ? exists("src/a.ts") : missing,
		);
		const links = await h.linksAt(1);
		const [file, url] = links ?? [];
		file?.activate(click(false), file.text);
		expect(h.opened).toEqual([]);
		file?.activate(click(true), file.text);
		url?.activate(click(true), url.text);
		expect(h.opened).toEqual([
			{ kind: "file", path: "src/a.ts", line: 3, col: 2 },
			{ kind: "url", url: "https://x.dev" },
		]);
	});

	test("a folder opens as a folder, without a line", async () => {
		const h = harness([row("src/")], () => folder("src"));
		const links = await h.linksAt(1);
		links?.[0]?.activate(click(true), "src/");
		expect(h.opened).toEqual([{ kind: "dir", path: "src" }]);
	});

	test("hovering shows the hint and leaving hides it", async () => {
		const h = harness([row("https://x.dev")]);
		const [link] = (await h.linksAt(1)) ?? [];
		link?.hover?.(click(false), link.text);
		link?.leave?.(click(false), link.text);
		expect(h.hints).toEqual([true, false]);
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
