import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { buildThemeCatalog } from "./runtime";

function bundledCandidates(): Record<string, unknown> {
	const dir = join(import.meta.dir, "bundled");
	return Object.fromEntries(
		readdirSync(dir)
			.filter((file) => file.endsWith(".theme.json"))
			.map((file) => [file, JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown]),
	);
}

test("the bundled catalog is indexed and sorted default-first, then by order", () => {
	const catalog = buildThemeCatalog(bundledCandidates());
	expect(catalog.list.length).toBeGreaterThan(1);
	expect(catalog.list[0]?.id).toBe(DEFAULT_CONFIG.theme);
	const orders = catalog.list.slice(1).map((theme) => theme.order);
	expect(orders).toEqual([...orders].sort((a, b) => a - b));
	for (const entry of catalog.list) expect(catalog.byId.get(entry.id)?.label).toBe(entry.label);
});

test("a duplicate id, an invalid manifest, or a missing default fails the build loudly", () => {
	const candidates = bundledCandidates();
	const first = Object.values(candidates)[0];
	expect(() =>
		buildThemeCatalog({ ...candidates, "zz-copy.theme.json": structuredClone(first) }),
	).toThrow("Duplicate bundled theme id");
	expect(() => buildThemeCatalog({ "broken.theme.json": { schemaVersion: 1 } })).toThrow(
		"Invalid bundled theme broken.theme.json",
	);
	const withoutDefault = Object.fromEntries(
		Object.entries(candidates).filter(
			([, value]) => (value as { id?: string }).id !== DEFAULT_CONFIG.theme,
		),
	);
	expect(() => buildThemeCatalog(withoutDefault)).toThrow("default theme is missing");
});
