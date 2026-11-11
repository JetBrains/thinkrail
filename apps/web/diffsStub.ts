import type { Plugin } from "vite";

const STUB_ID = "\0diffs-stub";
const UNUSED_SPECIFIER =
	/^shiki(\/|$)|^@pierre\/highlights\/themes(\/|$)|^@pierre\/theming\/themes$/;
const DIFFS_IMPORTER = /[\\/]@pierre[\\/+]diffs/;
const STUB_EXPORTS = [
	"bundledLanguages",
	"createCssVariablesTheme",
	"createHighlighterCore",
	"createJavaScriptRegexEngine",
	"createOnigurumaEngine",
	"EncodedTokenMetadata",
	"INITIAL",
	"normalizeTheme",
	"themes",
];

const stubSource = () =>
	[
		'const unavailable = () => { throw new Error("Not part of this build"); };',
		...STUB_EXPORTS.map((name) => `export const ${name} = unavailable;`),
	].join("\n");

export function diffsStub(): Plugin {
	return {
		name: "thinkrail:diffs-stub",
		enforce: "pre",
		resolveId(source, importer) {
			if (!UNUSED_SPECIFIER.test(source)) return null;
			return importer && DIFFS_IMPORTER.test(importer) ? STUB_ID : null;
		},
		load(id) {
			return id === STUB_ID ? stubSource() : null;
		},
	};
}
