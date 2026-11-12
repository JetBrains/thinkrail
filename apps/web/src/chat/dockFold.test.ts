import { expect, test } from "bun:test";
import { DEFAULT_DOCK_FOLD, dockCollapsed, withDockCollapsed } from "./dockFold";

test("without a docked question the dock follows the user's choice, or the count default", () => {
	expect(dockCollapsed(DEFAULT_DOCK_FOLD, null)).toBeNull();
	expect(dockCollapsed(withDockCollapsed(DEFAULT_DOCK_FOLD, null, true), null)).toBe(true);
	expect(dockCollapsed(withDockCollapsed(DEFAULT_DOCK_FOLD, null, false), null)).toBe(false);
});

test("a docked question folds the dock, a toggle lasts for that question, and answering restores the choice", () => {
	const unfolded = withDockCollapsed(DEFAULT_DOCK_FOLD, null, false);
	expect(dockCollapsed(unfolded, "q1")).toBe(true);

	const reopened = withDockCollapsed(unfolded, "q1", false);
	expect(dockCollapsed(reopened, "q1")).toBe(false);
	expect(dockCollapsed(reopened, null)).toBe(false);
	expect(dockCollapsed(reopened, "q2")).toBe(true);

	const untouched = DEFAULT_DOCK_FOLD;
	expect(dockCollapsed(untouched, "q1")).toBe(true);
	expect(dockCollapsed(untouched, null)).toBeNull();

	const foldedDuringQuestion = withDockCollapsed(
		withDockCollapsed(untouched, "q1", false),
		"q1",
		true,
	);
	expect(dockCollapsed(foldedDuringQuestion, null)).toBeNull();
});

test("a toggle after the question clears the question episode", () => {
	const during = withDockCollapsed(DEFAULT_DOCK_FOLD, "q1", false);
	const after = withDockCollapsed(during, null, true);
	expect(after).toEqual({ choice: true, question: null });
	expect(dockCollapsed(after, "q1")).toBe(true);
});
