import { expect, test } from "bun:test";
import { RiFileLine, RiPagesLine, RiStickyNoteLine } from "@remixicon/react";
import { outputFileIcon, outputFileLabel } from "./outputFile";

test("a known type drops its extension, reads underscores as spaces and names the type", () => {
	expect(outputFileLabel(".thinkrail/context/round-4/BUG_REPORT_subset.md")).toEqual({
		name: "BUG REPORT subset",
		type: "MD",
	});
	expect(outputFileLabel("mockups/checkout.HTML")).toEqual({ name: "checkout", type: "HTML" });
	expect(outputFileLabel("shots/after.jpeg")).toEqual({ name: "after", type: "JPG" });
});

test("any other file keeps its whole name and has no type", () => {
	expect(outputFileLabel("proofs/NSCal.lean")).toEqual({ name: "NSCal.lean", type: null });
	expect(outputFileLabel("README")).toEqual({ name: "README", type: null });
	expect(outputFileLabel(".env")).toEqual({ name: ".env", type: null });
});

test("the icon follows the type", () => {
	expect(outputFileIcon("a/FINDINGS.md")).toBe(RiStickyNoteLine);
	expect(outputFileIcon("a/index.html")).toBe(RiPagesLine);
	expect(outputFileIcon("a/NSCal.lean")).toBe(RiFileLine);
});
