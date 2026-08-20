import { expect, test } from "bun:test";
import { createReadSequencer } from "./useLiveTabContent";

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
