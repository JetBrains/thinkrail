import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RouteStore } from "./routeStore";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function routePath(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-routes-"));
	roots.push(root);
	mkdirSync(join(root, "nested"));
	return join(root, "nested", "routes.json");
}

test("persists routes independently by backend and window", () => {
	const path = routePath();
	const routes = new RouteStore(path);
	expect(routes.read("local", "main")).toBe("#/v1");
	expect(routes.write("local", "main", "#/v1/projects/project-1")).toBe(true);
	expect(routes.write("remote", "main", "#/v1/projects/project-2")).toBe(true);
	const restored = new RouteStore(path);
	expect(restored.read("local", "main")).toBe("#/v1/projects/project-1");
	expect(restored.read("remote", "main")).toBe("#/v1/projects/project-2");
});

test("rejects unbounded and control-bearing fragments", () => {
	const path = routePath();
	const routes = new RouteStore(path);
	expect(routes.write("local", "main", "https://example.com")).toBe(false);
	expect(routes.write("local", "main", `#${"x".repeat(4096)}`)).toBe(false);
	expect(routes.write("local", "main", "#/v1\nnext")).toBe(false);
	expect(existsSync(path)).toBe(false);
});

test("falls back from corrupt or unsupported route documents", () => {
	const path = routePath();
	writeFileSync(path, "not-json");
	expect(new RouteStore(path).read("local", "main")).toBe("#/v1");
	writeFileSync(path, JSON.stringify({ version: 2, routes: { "local:main": "#/v1/bad" } }));
	expect(new RouteStore(path).read("local", "main")).toBe("#/v1");
});

test("idempotent writes preserve the stored document", () => {
	const path = routePath();
	const routes = new RouteStore(path);
	routes.write("local", "main", "#/v1");
	const first = readFileSync(path, "utf8");
	routes.write("local", "main", "#/v1");
	expect(readFileSync(path, "utf8")).toBe(first);
});
