import { expect, test } from "bun:test";
import type { MonacoReviewZoneState } from "./reviewWidgets";
import { emitChangedZones } from "./reviewZoneEmit";

const node = () => ({}) as HTMLElement;

test("an empty zone list on mount does not emit", () => {
	const emitted: MonacoReviewZoneState[] = [];
	const emit = emitChangedZones((zones) => emitted.push(zones));
	emit({ threads: [], composer: null });
	emit({ threads: [], composer: null });
	expect(emitted).toHaveLength(0);
});

test("only a changed set of zone nodes emits", () => {
	const emitted: MonacoReviewZoneState[] = [];
	const emit = emitChangedZones((zones) => emitted.push(zones));
	const first = node();
	const composer = { node: node(), selection: { startLine: 2, endLine: 2 } };
	emit({ threads: [{ commentId: "a", node: first }], composer: null });
	emit({ threads: [{ commentId: "a", node: first }], composer: null });
	emit({ threads: [{ commentId: "a", node: node() }], composer: null });
	emit({ threads: [], composer });
	emit({ threads: [], composer: { ...composer } });
	emit({ threads: [], composer: null });
	expect(emitted.map((zones) => [zones.threads.length, zones.composer !== null])).toEqual([
		[1, false],
		[1, false],
		[0, true],
		[0, false],
	]);
});
