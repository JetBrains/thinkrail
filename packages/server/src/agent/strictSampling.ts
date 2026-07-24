// Strict-sampling wrapper for pi custom tools (pi ≥0.82 `Tool.constrainedSampling`).
//
// SCOPE — `ask_user_question` ONLY, by provider budget, not by preference. Every formerly-optional
// property the transform makes required-but-nullable adds one union (`anyOf`), and Anthropic's strict
// compiler enforces a hard PER-REQUEST budget across all tools it sees (live 400: “Schemas contains
// too many parameters with union types (39 …) … limit: 16 parameters with unions”). All our custom
// tools ride every session, and wrapping them all costs 39 unions — every request to a
// strict-capable Anthropic model fails outright. ask_user_question costs 3, the highest-value target
// (its nested options schema is where malformed args actually hurt). Opting another tool in means
// re-counting the shared budget — and its schema lives in a portable extension package, which would
// need its own copy of this helper (they carry no workspace deps).
//
// WHY THIS EXISTS: `strict: "prefer"` makes capable providers sample tool args that satisfy the schema
// by construction — but pi sends `tool.parameters` AS-IS, and OpenAI-style strict mode rejects any
// schema whose objects aren't `additionalProperties: false` with EVERY property required (optionals
// must be emulated as `T | null`). So opting in means transforming the schema — and then insulating
// both sides of it:
//   - non-strict models may still OMIT formerly-optional keys (yesterday's valid behavior): a
//     `prepareArguments` shim fills the missing null-union keys with `null` BEFORE pi validates;
//   - handlers keep their classic optionals: `execute` deep-strips `null` property values, so the
//     wrapped tool sees args matching the ORIGINAL schema's Static type (and any `details` built from
//     them stay null-free for renderers). The transcript keeps the model's raw (nullable) args —
//     renderers reading those were audited null-tolerant.
//
// CONSTRAINTS on wrapped tools:
//   - don't author `null`-typed params — property-level `null` is treated as "absent" (none of ours
//     do; authored null-unions are left unwrapped but their nulls are still stripped before execute);
//   - numeric/length constraint keywords (`maxItems`, `maxLength`, …) are STRIPPED from the advertised
//     schema: strict-mode providers validate the schema against a narrow keyword subset and 400 the
//     whole request otherwise (live Anthropic: `For 'array' type, property 'maxItems' is not
//     supported`). A tool that relies on such a limit must state it in the property `description` and
//     enforce it at runtime (ask_user_question's `validateQuestionnaire` does).

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

/** typebox 1.x schemas are plain JSON (no symbols), so the transform works on plain nodes. */
type JsonNode = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonNode {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a schema node already admits `null` (an authored or previously-wrapped null union). */
function admitsNull(node: unknown): boolean {
	if (!isPlainObject(node)) return false;
	if (node.type === "null") return true;
	return Array.isArray(node.anyOf) && node.anyOf.some((m) => isPlainObject(m) && m.type === "null");
}

/** Wrap a property schema as `T | null`, hoisting its description so pickers still surface it. */
function toNullUnion(node: unknown): unknown {
	if (admitsNull(node)) return node;
	const wrapped: JsonNode = { anyOf: [node, { type: "null" }] };
	if (isPlainObject(node) && typeof node.description === "string") {
		wrapped.description = node.description;
	}
	return wrapped;
}

// Keywords outside the strict-safe intersection (see header): strict-capable providers reject schemas
// carrying them, and one nonconforming tool 400s the whole request for every session it rides.
const STRICT_UNSUPPORTED_KEYWORDS = [
	"default",
	"examples",
	"minItems",
	"maxItems",
	"uniqueItems",
	"minContains",
	"maxContains",
	"minLength",
	"maxLength",
	"pattern",
	"format",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"minProperties",
	"maxProperties",
] as const;

function visit(node: unknown): void {
	if (!isPlainObject(node)) return;
	for (const keyword of STRICT_UNSUPPORTED_KEYWORDS) delete node[keyword];

	const props = node.properties;
	if (isPlainObject(props)) {
		const required = new Set(Array.isArray(node.required) ? node.required : []);
		for (const [key, prop] of Object.entries(props)) {
			visit(prop);
			if (!required.has(key)) props[key] = toNullUnion(prop);
		}
		node.required = Object.keys(props);
	}
	// Forbid unmatched keys — but never clobber an authored additionalProperties schema. Record-style
	// nodes (`Type.Record` → patternProperties) can't conform to OpenAI strict at all: keep them
	// functional here and DON'T opt such tools in (e.g. spec_update stays unwrapped).
	if (
		node.type === "object" &&
		node.additionalProperties === undefined &&
		!isPlainObject(node.patternProperties)
	) {
		node.additionalProperties = false;
	}
	if (isPlainObject(node.additionalProperties)) visit(node.additionalProperties);
	const patterns = node.patternProperties;
	if (isPlainObject(patterns)) for (const value of Object.values(patterns)) visit(value);

	if (Array.isArray(node.items)) for (const item of node.items) visit(item);
	else if (node.items) visit(node.items);

	for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
		const members = node[keyword];
		if (Array.isArray(members)) for (const member of members) visit(member);
	}
}

/**
 * Strict-conformant variant of a TypeBox/JSON schema: every object `additionalProperties: false` with
 * all properties required; formerly-optional properties become `{ anyOf: [T, { type: "null" }] }`;
 * `default` stripped. Pure — returns a transformed deep clone; idempotent.
 */
export function strictSchema<T extends TSchema>(schema: T): T {
	const clone = structuredClone(schema) as unknown as JsonNode;
	visit(clone);
	return clone as unknown as T;
}

/**
 * Fill missing null-union keys with `null` so a non-strict model omitting formerly-optional fields
 * still validates against the all-required transformed schema. Non-mutating (the input object is the
 * transcript's `toolCall.arguments` — pi replaces it only when `prepareArguments` returns a new one).
 */
function fillNulls(schema: unknown, value: unknown): unknown {
	if (!isPlainObject(schema)) return value;
	if (Array.isArray(schema.anyOf)) {
		if (value === null) return value;
		// Recurse into the non-null member of a null union (our wrapping produces exactly one).
		const inner = schema.anyOf.filter((m) => !(isPlainObject(m) && m.type === "null"));
		return inner.length === 1 ? fillNulls(inner[0], value) : value;
	}
	const props = schema.properties;
	if (isPlainObject(props) && isPlainObject(value)) {
		const out: JsonNode = { ...value };
		for (const [key, prop] of Object.entries(props)) {
			if (key in out) out[key] = fillNulls(prop, out[key]);
			else if (admitsNull(prop)) out[key] = null;
		}
		return out;
	}
	if (!Array.isArray(schema.items) && schema.items && Array.isArray(value)) {
		return value.map((item) => fillNulls(schema.items, item));
	}
	return value;
}

/** Deep-strip `null` property values so handlers see the original schema's optionals as absent. */
function stripNulls(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripNulls);
	if (isPlainObject(value)) {
		const out: JsonNode = {};
		for (const [key, entry] of Object.entries(value)) {
			if (entry !== null) out[key] = stripNulls(entry);
		}
		return out;
	}
	return value;
}

/**
 * Opt a tool definition into provider-side strict sampling (`strict: "prefer"` — capable models sample
 * schema-valid args; others fall back to normal tool calling). See the header for the full mechanics.
 * An authored `constrainedSampling` (including `false`) wins over the default.
 */
export function strictTool<TParams extends TSchema, TDetails, TState = unknown>(
	definition: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	const parameters = strictSchema(definition.parameters);
	const prepare = definition.prepareArguments;
	return {
		...definition,
		parameters,
		constrainedSampling: definition.constrainedSampling ?? {
			type: "json_schema",
			strict: "prefer",
		},
		prepareArguments: (args: unknown) =>
			// The fill's output conforms to the TRANSFORMED schema (nulls where the original had
			// optionals) — Static<TParams> is the closest expressible type; execute re-narrows by strip.
			fillNulls(parameters, prepare ? prepare(args) : args) as Static<TParams>,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			definition.execute(toolCallId, stripNulls(params) as Static<TParams>, signal, onUpdate, ctx),
	};
}
