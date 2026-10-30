import type { RunRecipe, RunRecipeError, RunTarget } from "@thinkrail/contracts";
import { RUN_RECIPE_LIMITS } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

export type RecipeValidation =
	| { ok: true; recipe: RunRecipe }
	| { ok: false; errors: RunRecipeError[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReservedPortVariable(name: string): boolean {
	const reserved: readonly string[] = RUN_RECIPE_LIMITS.reservedPortVariables;
	if (reserved.includes(name)) return true;
	return RUN_RECIPE_LIMITS.reservedPortVariablePrefixes.some((prefix) => name.startsWith(prefix));
}

function isWorktreeRelative(cwd: string): boolean {
	if (cwd === "" || cwd.startsWith("/") || cwd.startsWith("\\") || /^[A-Za-z]:/.test(cwd)) {
		return false;
	}
	return !cwd.split(/[\\/]/).some((segment) => segment === "..");
}

function placeholders(url: string): string[] {
	return [...url.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

function command(value: unknown, path: string, errors: RunRecipeError[]): string | undefined {
	if (typeof value !== "string" || value.trim() === "") {
		errors.push({ path, message: "must be a non-empty shell command" });
		return undefined;
	}
	if (value.length > RUN_RECIPE_LIMITS.commandChars) {
		errors.push({ path, message: `must be at most ${RUN_RECIPE_LIMITS.commandChars} characters` });
		return undefined;
	}
	return value;
}

/** `id` is reported even when the rest of the target fails, so `primary` is judged against every named target. */
function target(
	value: unknown,
	index: number,
	declaredPorts: ReadonlySet<string>,
	errors: RunRecipeError[],
): { id: string | undefined; target?: RunTarget } {
	const path = `targets/${index}`;
	if (!isRecord(value)) {
		errors.push({ path, message: "must be an object" });
		return { id: undefined };
	}
	let valid = true;
	const fail = (field: string, message: string) => {
		errors.push({ path: `${path}/${field}`, message });
		valid = false;
	};
	if (typeof value.id !== "string" || !RUN_RECIPE_LIMITS.targetIdPattern.test(value.id)) {
		fail(
			"id",
			"must be 1–41 lowercase letters, digits, '.', '_' or '-', starting with a letter or digit",
		);
	}
	if (value.title !== undefined && (typeof value.title !== "string" || value.title.length > 80)) {
		fail("title", "must be a string of at most 80 characters");
	}
	const cmd = command(value.command, `${path}/command`, errors);
	if (cmd === undefined) valid = false;
	if (value.kind !== "serve" && value.kind !== "task") fail("kind", "must be 'serve' or 'task'");
	if (value.ports !== undefined) {
		if (value.kind !== "serve") fail("ports", "only a serve target binds ports");
		else if (!Array.isArray(value.ports) || value.ports.some((name) => typeof name !== "string")) {
			fail("ports", "must be a list of declared port variable names");
		} else {
			for (const name of value.ports as string[]) {
				if (!declaredPorts.has(name)) fail("ports", `'${name}' is not declared under ports`);
			}
			if (new Set(value.ports).size !== value.ports.length)
				fail("ports", "must not repeat a variable");
		}
	}
	if (value.url !== undefined) {
		if (value.kind !== "serve") fail("url", "only a serve target has a url");
		else if (typeof value.url !== "string" || !/^https?:\/\//.test(value.url)) {
			fail("url", "must start with http:// or https://");
		} else {
			for (const name of placeholders(value.url)) {
				if (!declaredPorts.has(name)) fail("url", `'\${${name}}' is not a declared port variable`);
			}
		}
	}
	if (
		value.cwd !== undefined &&
		(typeof value.cwd !== "string" || !isWorktreeRelative(value.cwd))
	) {
		fail("cwd", "must be a relative path inside the worktree without '..'");
	}
	const id =
		typeof value.id === "string" && RUN_RECIPE_LIMITS.targetIdPattern.test(value.id)
			? value.id
			: undefined;
	if (!valid) return { id };
	const result: RunTarget = {
		id: value.id as string,
		command: cmd as string,
		kind: value.kind as RunTarget["kind"],
	};
	if (typeof value.title === "string") result.title = value.title;
	if (Array.isArray(value.ports)) result.ports = [...(value.ports as string[])];
	if (typeof value.url === "string") result.url = value.url;
	if (typeof value.cwd === "string") result.cwd = value.cwd;
	return { id, target: result };
}

/** Every rule of the recipe contract, reported as field errors the Edit dialog and the agent both read. */
export function validateRecipe(value: unknown): RecipeValidation {
	const errors: RunRecipeError[] = [];
	if (!isRecord(value)) return { ok: false, errors: [{ path: "", message: "must be an object" }] };
	if (JSON.stringify(value).length > RUN_RECIPE_LIMITS.documentChars) {
		return {
			ok: false,
			errors: [
				{ path: "", message: `must be at most ${RUN_RECIPE_LIMITS.documentChars} characters` },
			],
		};
	}
	if (value.version !== 1) errors.push({ path: "version", message: "must be 1" });

	const ports: Record<string, number> = {};
	if (value.ports !== undefined && !isRecord(value.ports)) {
		errors.push({ path: "ports", message: "must map variable names to natural ports" });
	} else if (value.ports !== undefined) {
		const seen = new Map<number, string>();
		for (const [name, port] of Object.entries(value.ports)) {
			if (!RUN_RECIPE_LIMITS.portVariablePattern.test(name) || isReservedPortVariable(name)) {
				errors.push({ path: `ports/${name}`, message: "is not an allowed variable name" });
				continue;
			}
			const { min, max } = RUN_RECIPE_LIMITS.portRange;
			if (typeof port !== "number" || !Number.isInteger(port) || port < min || port > max) {
				errors.push({ path: `ports/${name}`, message: `must be an integer port ${min}–${max}` });
				continue;
			}
			const other = seen.get(port);
			if (other !== undefined) {
				errors.push({ path: `ports/${name}`, message: `repeats the natural port of ${other}` });
				continue;
			}
			seen.set(port, name);
			ports[name] = port;
		}
	}
	const declared = new Set(Object.keys(ports));

	const prepare: string[] = [];
	if (value.prepare !== undefined && !Array.isArray(value.prepare)) {
		errors.push({ path: "prepare", message: "must be a list of shell commands" });
	} else if (Array.isArray(value.prepare)) {
		if (value.prepare.length > RUN_RECIPE_LIMITS.prepareCommands) {
			errors.push({
				path: "prepare",
				message: `must have at most ${RUN_RECIPE_LIMITS.prepareCommands} commands`,
			});
		}
		value.prepare.forEach((entry, index) => {
			const cmd = command(entry, `prepare/${index}`, errors);
			if (cmd !== undefined) prepare.push(cmd);
		});
	}

	const targets: RunTarget[] = [];
	if (!Array.isArray(value.targets) || value.targets.length === 0) {
		errors.push({ path: "targets", message: "must list at least one target" });
	} else {
		if (value.targets.length > RUN_RECIPE_LIMITS.targets) {
			errors.push({
				path: "targets",
				message: `must have at most ${RUN_RECIPE_LIMITS.targets} targets`,
			});
		}
		const ids = new Set<string>();
		value.targets.forEach((entry, index) => {
			const parsed = target(entry, index, declared, errors);
			if (parsed.id === undefined) return;
			if (ids.has(parsed.id)) {
				errors.push({ path: `targets/${index}/id`, message: `repeats '${parsed.id}'` });
				return;
			}
			ids.add(parsed.id);
			if (parsed.target) targets.push(parsed.target);
		});
		if (typeof value.primary !== "string" || !ids.has(value.primary)) {
			errors.push({ path: "primary", message: "must name one of the targets" });
		}
	}

	if (value.notes !== undefined && (typeof value.notes !== "string" || value.notes.length > 4096)) {
		errors.push({ path: "notes", message: "must be a string of at most 4096 characters" });
	}

	if (errors.length > 0) return { ok: false, errors };
	const recipe: RunRecipe = {
		version: 1,
		ports,
		prepare,
		targets,
		primary: value.primary as string,
	};
	if (typeof value.notes === "string" && value.notes !== "") recipe.notes = value.notes;
	return { ok: true, recipe };
}

export class RecipeInvalidError extends CodedError {
	readonly errors: RunRecipeError[];
	constructor(errors: RunRecipeError[]) {
		super(
			"RUN_RECIPE_INVALID",
			errors
				.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message))
				.join("; "),
		);
		this.errors = errors;
	}
}

export function assertRecipe(value: unknown): RunRecipe {
	const validation = validateRecipe(value);
	if (!validation.ok) throw new RecipeInvalidError(validation.errors);
	return validation.recipe;
}
