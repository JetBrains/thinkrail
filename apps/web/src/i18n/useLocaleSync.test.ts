import { expect, test } from "bun:test";
import type { LocalLocalesSnapshot } from "@thinkrail/contracts";
import { localeSignature } from "./useLocaleSync";

const snapshot = (files: LocalLocalesSnapshot["files"]): LocalLocalesSnapshot => ({
	dir: "/d",
	files,
});

test("the remount signature changes only with the tag or its fallback chain's strings", () => {
	const de = { fileName: "de.json", tag: "de", ok: true, strings: { a: "A" } } as const;
	const fr = { fileName: "fr.json", tag: "fr", ok: true, strings: { a: "Ah" } } as const;
	const base = localeSignature("de", snapshot([de]));
	expect(localeSignature("de", snapshot([de, fr]))).toBe(base);
	expect(localeSignature("de", snapshot([{ ...de, strings: { a: "B" } }]))).not.toBe(base);
	expect(localeSignature("de-AT", snapshot([de]))).not.toBe(base);
	expect(localeSignature("en", null)).toBe(localeSignature("en", snapshot([fr])));
});
