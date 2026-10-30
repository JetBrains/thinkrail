import { describe, expect, test } from "bun:test";
import type { RunRecipe } from "@thinkrail/contracts";
import { assertRecipe, RecipeInvalidError, validateRecipe } from "./recipe";

const valid: RunRecipe = {
	version: 1,
	ports: { PORT: 5173, API_PORT: 3100 },
	prepare: ["bun install", '[ -f .env ] || cp "$THINKRAIL_RUN_DEFAULT_WORKTREE/.env" .env'],
	targets: [
		{
			id: "dev",
			command: "bun run dev",
			kind: "serve",
			ports: ["PORT"],
			url: `http://localhost:\${PORT}/`,
		},
		{ id: "test", command: "bun test", kind: "task", cwd: "packages/server" },
	],
	primary: "dev",
	notes: "Needs docker for the database.",
};

function errorsOf(value: unknown): string[] {
	const result = validateRecipe(value);
	return result.ok ? [] : result.errors.map((error) => error.path);
}

describe("validateRecipe", () => {
	test("accepts a complete recipe and normalizes optional fields", () => {
		const result = validateRecipe(valid);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.recipe).toEqual(valid);
		const minimal = validateRecipe({
			version: 1,
			targets: [{ id: "a", command: "x", kind: "task" }],
			primary: "a",
		});
		expect(minimal.ok).toBe(true);
		if (!minimal.ok) return;
		expect(minimal.recipe).toEqual({
			version: 1,
			ports: {},
			prepare: [],
			targets: [{ id: "a", command: "x", kind: "task" }],
			primary: "a",
		});
	});

	test("rejects a non-object, a wrong version and an oversized document", () => {
		expect(errorsOf(null)).toEqual([""]);
		expect(errorsOf("recipe")).toEqual([""]);
		expect(errorsOf({ ...valid, version: 2 })).toEqual(["version"]);
		expect(errorsOf({ ...valid, notes: "x".repeat(40_000) })).toEqual([""]);
	});

	test("checks target ids, kinds, commands and uniqueness", () => {
		expect(
			errorsOf({ ...valid, targets: [{ id: "Dev", command: "x", kind: "task" }], primary: "Dev" }),
		).toEqual(["targets/0/id", "primary"]);
		expect(
			errorsOf({ ...valid, targets: [{ id: "a", command: "", kind: "task" }], primary: "a" }),
		).toEqual(["targets/0/command"]);
		expect(
			errorsOf({ ...valid, targets: [{ id: "a", command: "x", kind: "cron" }], primary: "a" }),
		).toEqual(["targets/0/kind"]);
		expect(
			errorsOf({
				...valid,
				targets: [
					{ id: "a", command: "x", kind: "task" },
					{ id: "a", command: "y", kind: "task" },
				],
				primary: "a",
			}),
		).toEqual(["targets/1/id"]);
		expect(errorsOf({ ...valid, targets: [] })).toEqual(["targets"]);
		expect(errorsOf({ ...valid, primary: "missing" })).toEqual(["primary"]);
	});

	test("checks port variable names, ranges and duplicates", () => {
		expect(errorsOf({ ...valid, ports: { port: 5173 } })).toContain("ports/port");
		for (const name of ["PATH", "HOME", "LD_PRELOAD", "DYLD_X", "THINKRAIL_PORT", "PI_MODEL"]) {
			expect(errorsOf({ ...valid, ports: { [name]: 5173 } })).toContain(`ports/${name}`);
		}
		expect(errorsOf({ ...valid, ports: { PORT: 80 } })).toContain("ports/PORT");
		expect(errorsOf({ ...valid, ports: { PORT: 70000 } })).toContain("ports/PORT");
		expect(errorsOf({ ...valid, ports: { PORT: 5173.5 } })).toContain("ports/PORT");
		expect(errorsOf({ ...valid, ports: { PORT: 5173, API_PORT: 5173 } })).toContain(
			"ports/API_PORT",
		);
	});

	test("ties target ports and url placeholders to declared variables, serve targets only", () => {
		expect(
			errorsOf({
				...valid,
				targets: [{ id: "dev", command: "x", kind: "serve", ports: ["DB_PORT"] }],
			}),
		).toEqual(["targets/0/ports"]);
		expect(
			errorsOf({
				...valid,
				targets: [{ id: "dev", command: "x", kind: "serve", url: `http://localhost:\${DB_PORT}/` }],
			}),
		).toEqual(["targets/0/url"]);
		expect(
			errorsOf({
				...valid,
				targets: [{ id: "dev", command: "x", kind: "serve", url: "localhost:5173" }],
			}),
		).toEqual(["targets/0/url"]);
		expect(
			errorsOf({
				...valid,
				targets: [{ id: "dev", command: "x", kind: "task", url: "http://localhost/" }],
			}),
		).toEqual(["targets/0/url"]);
		expect(
			errorsOf({ ...valid, targets: [{ id: "dev", command: "x", kind: "task", ports: ["PORT"] }] }),
		).toEqual(["targets/0/ports"]);
	});

	test("keeps cwd inside the worktree", () => {
		for (const cwd of ["/abs", "../up", "a/../../b", "C:\\x", ""]) {
			expect(
				errorsOf({ ...valid, targets: [{ id: "dev", command: "x", kind: "task", cwd }] }),
			).toEqual(["targets/0/cwd"]);
		}
		expect(
			errorsOf({ ...valid, targets: [{ id: "dev", command: "x", kind: "task", cwd: "apps/web" }] }),
		).toEqual([]);
	});

	test("bounds prepare and command sizes", () => {
		expect(errorsOf({ ...valid, prepare: "bun install" })).toEqual(["prepare"]);
		expect(errorsOf({ ...valid, prepare: Array.from({ length: 33 }, () => "true") })).toEqual([
			"prepare",
		]);
		expect(errorsOf({ ...valid, prepare: ["x".repeat(5000)] })).toEqual(["prepare/0"]);
		expect(errorsOf({ ...valid, prepare: [""] })).toEqual(["prepare/0"]);
	});

	test("assertRecipe throws a coded error carrying the field errors", () => {
		expect(() => assertRecipe({ ...valid, primary: "nope" })).toThrow(RecipeInvalidError);
		try {
			assertRecipe({ ...valid, primary: "nope" });
		} catch (error) {
			expect(error).toBeInstanceOf(RecipeInvalidError);
			expect((error as RecipeInvalidError).code).toBe("RUN_RECIPE_INVALID");
			expect((error as RecipeInvalidError).errors).toEqual([
				{ path: "primary", message: "must name one of the targets" },
			]);
		}
	});
});
