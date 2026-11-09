import type { Plugin } from "vite";

const STUB_ID = "\0shiki-stub";
const SHIKI_SPECIFIER = /^shiki(\/|$)/;
const DIFFS_IMPORTER = /[\\/]@pierre[\\/+]diffs/;
const STUB_EXPORTS = [
	"createCssVariablesTheme",
	"createHighlighterCore",
	"EncodedTokenMetadata",
	"INITIAL",
];

const stubSource = () =>
	[
		'const unavailable = () => { throw new Error("Shiki is not part of this build"); };',
		...STUB_EXPORTS.map((name) => `export const ${name} = unavailable;`),
	].join("\n");

export function shikiStub(): Plugin {
	return {
		name: "thinkrail:shiki-stub",
		enforce: "pre",
		resolveId(source, importer) {
			if (!SHIKI_SPECIFIER.test(source)) return null;
			return importer && DIFFS_IMPORTER.test(importer) ? STUB_ID : null;
		},
		load(id) {
			return id === STUB_ID ? stubSource() : null;
		},
	};
}
