import { expect, test } from "bun:test";
import { reconcileAnnotationSlots } from "./annotationSlots";

interface Annotation {
	lineNumber: number;
}

const equal = (left: Annotation, right: Annotation) => left.lineNumber === right.lineNumber;

test("inserting a comment before an existing id appends a slot without changing the existing index", () => {
	const first = reconcileAnnotationSlots(
		[],
		[{ id: "existing", annotation: { lineNumber: 8 } }],
		equal,
	);
	const second = reconcileAnnotationSlots(
		first,
		[
			{ id: "inserted", annotation: { lineNumber: 2 } },
			{ id: "existing", annotation: { lineNumber: 8 } },
		],
		equal,
	);

	expect(second.map((slot) => slot.id)).toEqual(["existing", "inserted"]);
	expect(second.findIndex((slot) => slot.id === "existing")).toBe(0);
});

test("a removed comment keeps its tombstone slot and a new id appends after it", () => {
	const first = reconcileAnnotationSlots(
		[],
		[
			{ id: "removed", annotation: { lineNumber: 3 } },
			{ id: "kept", annotation: { lineNumber: 8 } },
		],
		equal,
	);
	const second = reconcileAnnotationSlots(
		first,
		[
			{ id: "kept", annotation: { lineNumber: 8 } },
			{ id: "new", annotation: { lineNumber: 10 } },
		],
		equal,
	);

	expect(second.map((slot) => slot.id)).toEqual(["removed", "kept", "new"]);
	expect(second[0]?.annotation.lineNumber).toBe(3);
});
