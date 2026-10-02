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
