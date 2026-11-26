import { expect, test } from "bun:test";
import { cn } from "./utils";

test("cn composes conditional and nested classes", () => {
	expect(cn("flex", ["items-center", false, ["gap-4"]], { hidden: false, truncate: true })).toBe(
		"flex items-center gap-4 truncate",
	);
	expect(cn(null, undefined, false)).toBe("");
});

test("cn lets callers override conflicting utilities without dropping semantic typography", () => {
	expect(cn("p-8 tr-text-ui text-text-muted", "p-12 text-text-default")).toBe(
		"tr-text-ui p-12 text-text-default",
	);
	expect(cn("hover:p-8 p-4", "hover:p-12")).toBe("p-4 hover:p-12");
});

test("cn resolves a named layout role against a numeric step of the same utility", () => {
	expect(cn("size-28", "size-panel-row")).toBe("size-panel-row");
	expect(cn("p-8 h-24", "p-panel-inset h-panel-row")).toBe("p-panel-inset h-panel-row");
	expect(cn("px-chat-gutter", "px-4")).toBe("px-4");
});

test("cn lets a caller's own top and translate replace the dialog's rounded centre", () => {
	expect(
		cn(
			"-translate-x-(--dialog-center) -translate-y-(--dialog-center) top-(--dialog-center) left-(--dialog-center)",
			"top-[12vh] translate-y-0",
		),
	).toBe("-translate-x-(--dialog-center) left-(--dialog-center) top-[12vh] translate-y-0");
});

test("cn lets a later focus ring placement replace an earlier one", () => {
	expect(cn("focus-visible:focus-ring", "focus-visible:focus-ring-inset")).toBe(
		"focus-visible:focus-ring-inset",
	);
	expect(cn("focus-visible:focus-ring-inset", "focus-visible:focus-ring")).toBe(
		"focus-visible:focus-ring",
	);
});

test("cn lets a later outline-none drop an earlier focus ring", () => {
	expect(cn("focus-visible:focus-ring", "focus-visible:outline-none")).toBe(
		"focus-visible:outline-none",
	);
	expect(cn("outline-none focus-visible:focus-ring")).toBe("outline-none focus-visible:focus-ring");
});
