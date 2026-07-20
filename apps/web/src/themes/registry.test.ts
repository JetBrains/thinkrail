import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ThemeRegistry } from "./registry";

function fixture(name: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(join(import.meta.dir, "bundled", `${name}.theme.json`), "utf8"),
	) as Record<string, unknown>;
}

test("catalog snapshots are stable, default-first, and deterministic", () => {
	const registry = new ThemeRegistry("dark");
	let notifications = 0;
	registry.subscribe(() => notifications++);
	registry.register(fixture("light"));
	registry.register(fixture("dark"));
	registry.register(fixture("gruvbox"));

	const first = registry.getSnapshot();
	expect(registry.getSnapshot()).toBe(first);
	expect(first.map((theme) => theme.id)).toEqual(["dark", "light", "gruvbox"]);
	expect(notifications).toBe(3);
});

test("duplicate ids are rejected rather than shadowing an existing theme", () => {
	const registry = new ThemeRegistry("dark");
	registry.register(fixture("dark"));
	expect(() => registry.register(fixture("dark"))).toThrow("already registered");
	expect(registry.getSnapshot()).toHaveLength(1);
});

test("an unavailable request falls back, then resolves after late registration and disposal", () => {
	const registry = new ThemeRegistry("dark");
	registry.register(fixture("dark"));
	const late = fixture("gruvbox");
	late.id = "acme.late";
	late.label = "Late Theme";

	expect(registry.resolve("acme.late")?.id).toBe("dark");
	const registration = registry.register(late);
	expect(registry.resolve("acme.late")?.id).toBe("acme.late");
	registration.dispose();
	expect(registry.resolve("acme.late")?.id).toBe("dark");
	registration.dispose();
	expect(registry.getSnapshot()).toHaveLength(1);
});
