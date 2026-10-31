import { expect, test } from "bun:test";
import {
	createReadSequencer,
	createTabReader,
	tickReadDecision,
	tickReadSettle,
} from "./useLiveTabContent";

test("the response of a superseded read never applies; the newest read always does", () => {
	const sequencer = createReadSequencer();

	const fsRead = sequencer.begin();
	expect(fsRead()).toBe(true);
	const targetRead = sequencer.begin();

	expect(targetRead()).toBe(true);
	expect(fsRead()).toBe(false);
	expect(targetRead()).toBe(true);
	expect(fsRead()).toBe(false);
});

test("an uncontested read applies whenever it resolves", () => {
	const sequencer = createReadSequencer();
	const only = sequencer.begin();
	expect(only()).toBe(true);
});

test("each new read supersedes every earlier one, not just the immediately preceding read", () => {
	const sequencer = createReadSequencer();
	const first = sequencer.begin();
	const second = sequencer.begin();
	const third = sequencer.begin();
	expect(first()).toBe(false);
	expect(second()).toBe(false);
	expect(third()).toBe(true);
});

test("sequencers are per-tab: one tab's read does not supersede another's", () => {
	const a = createReadSequencer();
	const b = createReadSequencer();
	const aRead = a.begin();
	b.begin();
	expect(aRead()).toBe(true);
});

const decide = (input: Partial<Parameters<typeof tickReadDecision>[0]>) =>
	tickReadDecision({
		changeTick: 5,
		paths: null,
		loaded: 4,
		path: "a.ts",
		inFlightPath: null,
		...input,
	});

test("a tick at or below the loaded tick needs nothing, even with a read in flight", () => {
	expect(decide({ changeTick: 4 })).toBe("none");
	expect(decide({ changeTick: 3, inFlightPath: "a.ts" })).toBe("none");
});

test("the next tick that names other paths keeps the current content without a read", () => {
	expect(decide({ paths: ["b.ts"] })).toBe("keep");
	expect(decide({ paths: ["a.ts"] })).toBe("read");
	expect(decide({ changeTick: 6, paths: ["b.ts"] })).toBe("read");
});

test("a tick that lands while this path is being read waits for the read to settle", () => {
	expect(decide({ inFlightPath: "a.ts" })).toBe("wait");
	expect(decide({ changeTick: 9, paths: ["a.ts"], inFlightPath: "a.ts" })).toBe("wait");
});

test("a read in flight for another path does not block a read of the new path", () => {
	expect(decide({ inFlightPath: "old.ts" })).toBe("read");
});

const settle = (input: Partial<Parameters<typeof tickReadSettle>[0]>) =>
	tickReadSettle({ current: true, loaded: 4, started: 5, latestTick: 5, ...input });

test("a current tick read applies and rechecks only when a newer tick landed", () => {
	expect(settle({})).toEqual({ apply: true, recheck: false });
	expect(settle({ latestTick: 6 })).toEqual({ apply: true, recheck: true });
});

test("a tick read superseded before it applied rechecks so the tab does not stay stale", () => {
	expect(settle({ current: false })).toEqual({ apply: false, recheck: true });
	expect(settle({ current: false, loaded: 5 })).toEqual({ apply: false, recheck: false });
});

function liveTab() {
	const tab = { workspaceId: "w", path: "a.ts", loadedTick: 0, content: "v0" };
	let disk = "v1";
	let tick = 0;
	const reads: Array<{ snapshot: string; resolve: () => void; reject: () => void }> = [];
	const reader = createTabReader<string>({
		tab: () => tab,
		ops: () => ({
			read: () => {
				const snapshot = disk;
				return new Promise<string>((resolve, reject) =>
					reads.push({ snapshot, resolve: () => resolve(snapshot), reject }),
				);
			},
			applyFresh: (fresh, at) => {
				tab.content = fresh;
				tab.loadedTick = at;
			},
			keepCurrent: (at) => {
				tab.loadedTick = at;
			},
		}),
		latestTick: () => tick,
		mounted: () => true,
		recheck: () => reader.onTick(tick, ["a.ts"]),
	});
	const flush = async () => {
		for (let i = 0; i < 6; i += 1) await Promise.resolve();
	};
	return {
		tab,
		reads,
		reader,
		flush,
		write: (next: string) => {
			disk = next;
			tick += 1;
			reader.onTick(tick, ["a.ts"]);
		},
	};
}

test("a reload that settles while a tick waits is stamped at its start tick, so the tick still re-reads", async () => {
	const { tab, reads, reader, flush, write } = liveTab();
	write("v1");
	reader.reload();
	write("v2");
	expect(reads.map((r) => r.snapshot)).toEqual(["v1", "v1"]);
	reads[1]?.resolve();
	await flush();
	reads[0]?.resolve();
	await flush();
	expect(reads.map((r) => r.snapshot)).toEqual(["v1", "v1", "v2"]);
	reads[2]?.resolve();
	await flush();
	expect(tab).toMatchObject({ content: "v2", loadedTick: 2 });
});

test("a failed reload keeps the content and lets a waiting tick read", async () => {
	const { tab, reads, reader, flush, write } = liveTab();
	reader.reload();
	write("v2");
	reads[0]?.reject();
	await flush();
	expect(reads.map((r) => r.snapshot)).toEqual(["v1", "v2"]);
	reads[1]?.resolve();
	await flush();
	expect(tab).toMatchObject({ content: "v2", loadedTick: 1 });
});
