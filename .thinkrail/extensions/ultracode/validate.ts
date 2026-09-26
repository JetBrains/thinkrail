import { Format } from "typebox/format";
import { Errors } from "typebox/schema";
import type { JsonSchema } from "./types";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const typeOf = (value: unknown): string => {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
};

const pathFromPointer = (pointer: string): string => {
	const segments = pointer
		.split("/")
		.slice(1)
		.map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
	return segments.reduce((acc, segment) => {
		if (/^\d+$/.test(segment)) return `${acc}[${segment}]`;
		if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) return acc ? `${acc}.${segment}` : segment;
		return `${acc}[${JSON.stringify(segment)}]`;
	}, "");
};

export const validate = (value: unknown, schema: JsonSchema): ValidationResult => {
	let ok: boolean;
	let failures: ReadonlyArray<{ instancePath: string; keyword: string; message: string }>;
	try {
		[ok, failures] = Errors(schema, value);
	} catch (error) {
		return { ok: false, errors: [`schema could not be evaluated: ${(error as Error).message}`] };
	}
	if (ok) return { ok: true };
	const errors = failures.map((failure) => {
		const where = pathFromPointer(failure.instancePath) || "value";
		const message = failure.keyword === "boolean" ? "is not allowed here" : failure.message;
		return `${where}: ${message}`;
	});
	return { ok: false, errors: errors.length > 0 ? errors : ["value does not match the schema"] };
};

const ANNOTATIONS = new Set([
	"$schema",
	"$comment",
	"title",
	"description",
	"default",
	"example",
	"examples",
	"deprecated",
	"readOnly",
	"writeOnly",
	"contentEncoding",
	"contentMediaType",
]);

const TYPE_NAMES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);

interface Context {
	root: unknown;
	problems: string[];
	seen: Set<object>;
	done: Set<object>;
}

const childPath = (path: string, key: string): string =>
	/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const pointerSegments = (ref: string): string[] =>
	ref
		.slice(2)
		.split("/")
		.map((segment) => decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~"));

const refPath = (ref: string): string =>
	ref === "#" ? "schema" : pointerSegments(ref).reduce(childPath, "schema");

const resolvePointer = (root: unknown, ref: string): unknown => {
	if (ref === "#") return root;
	const segments = pointerSegments(ref);
	let current: unknown = root;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
			current = current[index];
		} else if (isPlainObject(current)) {
			if (!(segment in current)) return undefined;
			current = current[segment];
		} else return undefined;
	}
	return current;
};

const walkSchema = (node: unknown, path: string, ctx: Context): void => {
	if (typeof node === "boolean") return;
	if (!isPlainObject(node)) {
		ctx.problems.push(`${path}: expected a schema object, got ${typeOf(node)}`);
		return;
	}
	if (ctx.seen.has(node)) {
		ctx.problems.push(`${path}: the schema object contains a cycle`);
		return;
	}
	if (ctx.done.has(node)) return;
	ctx.seen.add(node);
	for (const [keyword, value] of Object.entries(node)) {
		if (ANNOTATIONS.has(keyword)) continue;
		const checkKeyword = KEYWORDS.get(keyword);
		if (!checkKeyword) {
			const hint =
				keyword === "nullable"
					? '; use type: ["<type>", "null"]'
					: keyword === "$id" || keyword === "$anchor"
						? "; references must be local JSON pointers"
						: "";
			ctx.problems.push(`${path}: unsupported keyword "${keyword}"${hint}`);
			continue;
		}
		checkKeyword(value, childPath(path, keyword), ctx);
	}
	ctx.seen.delete(node);
	ctx.done.add(node);
};

type KeywordCheck = (value: unknown, path: string, ctx: Context) => void;

const schemaList: KeywordCheck = (value, path, ctx) => {
	if (!Array.isArray(value)) {
		ctx.problems.push(`${path}: expected an array of schemas, got ${typeOf(value)}`);
		return;
	}
	if (value.length === 0) ctx.problems.push(`${path}: must list at least one schema`);
	for (const [index, entry] of value.entries()) walkSchema(entry, `${path}[${index}]`, ctx);
};

const schemaMap: KeywordCheck = (value, path, ctx) => {
	if (!isPlainObject(value)) {
		ctx.problems.push(`${path}: expected an object of schemas, got ${typeOf(value)}`);
		return;
	}
	for (const [key, entry] of Object.entries(value)) walkSchema(entry, childPath(path, key), ctx);
};

const patternSchemaMap: KeywordCheck = (value, path, ctx) => {
	if (isPlainObject(value)) {
		for (const key of Object.keys(value)) {
			try {
				new RegExp(key);
			} catch (error) {
				ctx.problems.push(
					`${childPath(path, key)}: not a usable regular expression (${(error as Error).message})`,
				);
			}
		}
	}
	schemaMap(value, path, ctx);
};

const number: KeywordCheck = (value, path, ctx) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		ctx.problems.push(`${path}: expected a number, got ${typeOf(value)}`);
	}
};

const positiveNumber: KeywordCheck = (value, path, ctx) => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		ctx.problems.push(`${path}: expected a number greater than 0`);
	}
};

const count: KeywordCheck = (value, path, ctx) => {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		ctx.problems.push(`${path}: expected a non-negative integer, got ${JSON.stringify(value)}`);
	}
};

const boolean: KeywordCheck = (value, path, ctx) => {
	if (typeof value !== "boolean")
		ctx.problems.push(`${path}: expected true or false, got ${typeOf(value)}`);
};

const stringList: KeywordCheck = (value, path, ctx) => {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		ctx.problems.push(`${path}: expected an array of property names`);
	}
};

const stringListMap: KeywordCheck = (value, path, ctx) => {
	if (!isPlainObject(value)) {
		ctx.problems.push(`${path}: expected an object of property-name arrays, got ${typeOf(value)}`);
		return;
	}
	for (const [key, entry] of Object.entries(value)) stringList(entry, childPath(path, key), ctx);
};

const anything: KeywordCheck = () => {};

const KEYWORD_CHECKS: Record<string, KeywordCheck> = {
	type: (value, path, ctx) => {
		const names = Array.isArray(value) ? value : [value];
		if (Array.isArray(value) && value.length === 0)
			ctx.problems.push(`${path}: must name at least one type`);
		for (const name of names) {
			if (typeof name !== "string" || !TYPE_NAMES.has(name)) {
				ctx.problems.push(`${path}: unknown type ${JSON.stringify(name)}`);
			}
		}
	},
	enum: (value, path, ctx) => {
		if (!Array.isArray(value)) ctx.problems.push(`${path}: expected an array of allowed values`);
		else if (value.length === 0) ctx.problems.push(`${path}: must list at least one allowed value`);
	},
	const: anything,

	properties: schemaMap,
	patternProperties: patternSchemaMap,
	propertyNames: walkSchema,
	additionalProperties: walkSchema,
	unevaluatedProperties: walkSchema,
	required: stringList,
	minProperties: count,
	maxProperties: count,
	dependentRequired: stringListMap,
	dependentSchemas: schemaMap,

	items: (value, path, ctx) => {
		if (Array.isArray(value)) schemaList(value, path, ctx);
		else walkSchema(value, path, ctx);
	},
	prefixItems: schemaList,
	additionalItems: walkSchema,
	unevaluatedItems: walkSchema,
	contains: walkSchema,
	minContains: count,
	maxContains: count,
	minItems: count,
	maxItems: count,
	uniqueItems: boolean,

	minLength: count,
	maxLength: count,
	pattern: (value, path, ctx) => {
		if (typeof value !== "string") {
			ctx.problems.push(`${path}: expected a regular expression string, got ${typeOf(value)}`);
			return;
		}
		try {
			new RegExp(value);
		} catch (error) {
			ctx.problems.push(`${path}: not a usable regular expression (${(error as Error).message})`);
		}
	},
	format: (value, path, ctx) => {
		if (typeof value !== "string" || !Format.Has(value)) {
			ctx.problems.push(
				`${path}: unknown format ${JSON.stringify(value)}; known formats are ${Format.Entries()
					.map(([name]) => name)
					.join(", ")}`,
			);
		}
	},

	minimum: number,
	maximum: number,
	exclusiveMinimum: number,
	exclusiveMaximum: number,
	multipleOf: positiveNumber,

	allOf: schemaList,
	anyOf: schemaList,
	oneOf: schemaList,
	not: walkSchema,
	if: walkSchema,
	else: walkSchema,

	$defs: schemaMap,
	definitions: schemaMap,
	$ref: (value, path, ctx) => {
		if (typeof value !== "string") {
			ctx.problems.push(`${path}: expected a reference string, got ${typeOf(value)}`);
			return;
		}
		if (value !== "#" && !value.startsWith("#/")) {
			ctx.problems.push(
				`${path}: only local references ("#/..." JSON pointers) are supported, got ${JSON.stringify(value)}`,
			);
			return;
		}
		const target = resolvePointer(ctx.root, value);
		if (target === undefined) {
			ctx.problems.push(
				`${path}: reference ${JSON.stringify(value)} does not resolve in this schema`,
			);
			return;
		}
		if (isPlainObject(target) && ctx.seen.has(target)) return;
		walkSchema(target, refPath(value), ctx);
	},
};

const KEYWORDS = new Map<string, KeywordCheck>([
	...Object.entries(KEYWORD_CHECKS),
	["then", walkSchema],
]);

const MAX_REPORTED = 8;

export const assertSchemaSupported = (schema: JsonSchema): void => {
	if (!isPlainObject(schema)) {
		throw new Error(`agent() schema must be a JSON Schema object, got ${typeOf(schema)}`);
	}
	const ctx: Context = { root: schema, problems: [], seen: new Set(), done: new Set() };
	walkSchema(schema, "schema", ctx);
	if (ctx.problems.length === 0) return;
	const shown = ctx.problems.slice(0, MAX_REPORTED);
	const rest = ctx.problems.length - shown.length;
	throw new Error(
		`agent() schema cannot be enforced: ${shown.join("; ")}${rest > 0 ? `; (+${rest} more)` : ""}`,
	);
};
