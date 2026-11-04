import { EXTENSION_TO_FILE_FORMAT } from "@pierre/diffs";
import type { ResourceCodeLanguage } from "../host";

const FILE_TYPE_OVERRIDES: Readonly<Record<string, string>> = {
	c3: "c3",
	cu: "cu",
	cuh: "cu",
	groq: "groq",
	just: "just",
	Justfile: "just",
	kdl: "kdl",
	m: "objective-c",
	mbt: "moonbit",
	msg: "rosmsg",
	promql: "promql",
	scad: "openscad",
	tsrx: "tsrx",
};
const NOT_HIGHLIGHTED_KEYS = new Set([
	"BUCK",
	"BUILD",
	"component.ts",
	"P",
	"PACKAGE",
	"vine.ts",
	"WORKSPACE",
]);
const PLAIN_FILE_TYPE = "text";
const FILE_NAME_KEY = /^[A-Z].|^git-rebase-todo$/;

export function editorLanguages(
	catalog: readonly ResourceCodeLanguage[],
	table: Readonly<Record<string, string | undefined>> = {
		...EXTENSION_TO_FILE_FORMAT,
		...FILE_TYPE_OVERRIDES,
	},
): ResourceCodeLanguage[] {
	const claimed = new Set(
		catalog
			.flatMap((language) => [...language.extensions, ...(language.filenames ?? [])])
			.map((value) => value.toLowerCase()),
	);
	const added = new Map<string, { extensions: string[]; filenames: string[] }>();
	for (const [key, id] of Object.entries(table)) {
		if (!id || id === PLAIN_FILE_TYPE || NOT_HIGHLIGHTED_KEYS.has(key)) continue;
		const isFileName = FILE_NAME_KEY.test(key);
		const value = isFileName ? key : `.${key}`;
		if (claimed.has(value.toLowerCase())) continue;
		const entry = added.get(id) ?? { extensions: [], filenames: [] };
		added.set(id, entry);
		(isFileName ? entry.filenames : entry.extensions).push(value);
	}
	const extended = catalog.map((language) => {
		const entry = added.get(language.id);
		return {
			...language,
			extensions: [...language.extensions, ...(entry?.extensions ?? [])],
			filenames: [...(language.filenames ?? []), ...(entry?.filenames ?? [])],
		};
	});
	const catalogIds = new Set(catalog.map(({ id }) => id));
	const others = [...added]
		.filter(([id]) => !catalogIds.has(id))
		.map(([id, files]) => ({ id, aliases: [], ...files }));
	return [...extended, ...others];
}
