import { expect, test } from "bun:test";
import { createReadSequencer } from "./useLiveTabContent";

/**
 * A tab is live in two dimensions (the workspace's fs tick and, for a diff tab, the review target), and each
 * is its own effect — so two reads can be in flight at once and the network decides which lands last. Without
 * an order guard the *older* read wins that race and overwrites the newer one's content while carrying its
 * own (honest, but now stale) stamp: no drift is left for either effect to see, so the pane sits on the old
 * target's diff under the new target's label indefinitely. `createReadSequencer` is that guard.
 */
test("the response of a superseded read never applies; the newest read always does", () => {
	const sequencer = createReadSequencer();

	// A slow fs-tick re-read leaves (against the old target)...
	const fsRead = sequencer.begin();
	expect(fsRead()).toBe(true);
	// ...then the user re-points the target, starting the second read.
	const targetRead = sequencer.begin();

	// The new-target read lands first and applies.
	expect(targetRead()).toBe(true);
	// The older read resolves afterwards and must be dropped, not applied on top of it.
	expect(fsRead()).toBe(false);
	// Being asked twice changes nothing (a `.then` and a `.catch` path ask independently).
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

/** Independent tabs are independent races — one pane's re-read must not silence another's. */
test("sequencers are per-tab: one tab's read does not supersede another's", () => {
	const a = createReadSequencer();
	const b = createReadSequencer();
	const aRead = a.begin();
	b.begin();
	expect(aRead()).toBe(true);
});
