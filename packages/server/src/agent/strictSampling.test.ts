import { expect, test } from "bun:test";
import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { AskUserQuestionSchema } from "./askUserQuestion";
import { strictSchema, strictTool } from "./strictSampling";

// A schema exercising every transform case: required + optional scalars, an optional array of objects
// with their own optionals, a `default`, and constraint keywords that must survive.
const OptionSchema = Type.Object({
	label: Type.String({ maxLength: 10 }),
	preview: Type.Optional(Type.String({ description: "markdown preview" })),
});
const ParamsSchema = Type.Object({
	title: Type.String(),
	note: Type.Optional(Type.String({ description: "a note" })),
	flag: Type.Optional(Type.Boolean({ default: false })),
	options: Type.Optional(Type.Array(OptionSchema, { minItems: 1 })),
});
type Params = Static<typeof ParamsSchema>;

type Node = Record<string, unknown>;
const strict = strictSchema(ParamsSchema) as unknown as Node;
const props = strict.properties as Record<string, Node>;

test("every object node becomes additionalProperties:false with ALL properties required", () => {
	expect(strict.additionalProperties).toBe(false);
	expect([...(strict.required as string[])].sort()).toEqual(["flag", "note", "options", "title"]);

	const optionNode = ((props.options as Node).anyOf as Node[])[0]?.items as Node;
	expect(optionNode.additionalProperties).toBe(false);
	expect([...(optionNode.required as string[])].sort()).toEqual(["label", "preview"]);
});

test("formerly-optional properties become null unions with the description hoisted", () => {
	const note = props.note as Node;
	expect(note.anyOf).toEqual([{ type: "string", description: "a note" }, { type: "null" }]);
	expect(note.description).toBe("a note");
	// Required properties stay untouched (constraints intact).
	expect(props.title).toEqual({ type: "string" });
});

test("strict-unsupported keywords are stripped everywhere (default, minItems, maxLength, …)", () => {
	// Strict-mode providers validate schemas against a narrow keyword subset and 400 the whole request
	// otherwise (live Anthropic: `For 'array' type, property 'maxItems' is not supported`).
	const flagInner = ((props.flag as Node).anyOf as Node[])[0] as Node;
	expect("default" in flagInner).toBe(false);
	expect("minItems" in (((props.options as Node).anyOf as Node[])[0] as Node)).toBe(false);
	const optionNode = ((props.options as Node).anyOf as Node[])[0]?.items as Node;
	expect("maxLength" in ((optionNode.properties as Record<string, Node>).label as Node)).toBe(
		false,
	);
	// Enum survives — it's in the strict-safe subset and models rely on it.
	const withEnum = strictSchema(Type.Object({ kind: StringEnum(["a", "b"]) })) as unknown as Node;
	expect((withEnum.properties as Record<string, Node>).kind?.enum).toEqual(["a", "b"]);
});

test("record-style nodes (Type.Record → patternProperties) are preserved, never clobbered", () => {
	const record = strictSchema(
		Type.Object({ set: Type.Optional(Type.Record(Type.String(), Type.String())) }),
	) as unknown as Node;
	const setNode = ((record.properties as Record<string, Node>).set?.anyOf as Node[])[0] as Node;
	// The record keeps validating arbitrary string keys — additionalProperties is NOT forced false…
	expect(setNode.patternProperties).toEqual({ "^.*$": { type: "string" } });
	expect("additionalProperties" in setNode).toBe(false);
	// …which also means such a schema can't conform to OpenAI strict: tools carrying records stay
	// unwrapped (spec_update) — this test pins that the helper at least never corrupts them.
	const check = Compile(record as never);
	expect(check.Check({ set: { title: "x" } })).toBe(true);
	expect(check.Check({ set: null })).toBe(true);
});

test("the transform is idempotent and never mutates its input", () => {
	const before = JSON.stringify(ParamsSchema);
	strictSchema(ParamsSchema);
	expect(JSON.stringify(ParamsSchema)).toBe(before);
	expect(strictSchema(strict as never)).toEqual(strict as never);
});

// ---- validation behavior, compiled exactly like pi's validator (typebox/compile) ----

test("compiled transformed schema: nulls pass, omissions fail, extra props fail (strict semantics)", () => {
	const check = Compile(strict as never);
	expect(
		check.Check({ title: "t", note: null, flag: null, options: [{ label: "a", preview: null }] }),
	).toBe(true);
	expect(check.Check({ title: "t", note: "n", flag: true, options: null })).toBe(true);
	// All-required now: a bare omission no longer validates (the prepareArguments fill repairs it).
	expect(check.Check({ title: "t" })).toBe(false);
	expect(check.Check({ title: "t", note: null, flag: null, options: null, zzz: 1 })).toBe(false);
});

// ---- the Anthropic union budget ----

test("the wrapped ask schema stays far under Anthropic's 16-union-per-request budget", () => {
	// Anthropic strict tools 400 the WHOLE request past “16 parameters with unions” counted across all
	// tools — the reason only ask_user_question is wrapped (see header). Pin its cost so growth is loud.
	const unionCount = (node: unknown): number => {
		if (Array.isArray(node)) return node.reduce((sum: number, m) => sum + unionCount(m), 0);
		if (typeof node !== "object" || node === null) return 0;
		const n = node as Record<string, unknown>;
		return (
			(Array.isArray(n.anyOf) ? 1 : 0) +
			Object.values(n).reduce((sum: number, v) => sum + unionCount(v), 0)
		);
	};
	expect(unionCount(strictSchema(AskUserQuestionSchema))).toBe(3);
});

// ---- strictTool wiring ----

function makeTool(
	execute: ToolDefinition<typeof ParamsSchema, unknown>["execute"],
): ToolDefinition<typeof ParamsSchema, unknown> {
	return {
		name: "probe",
		label: "Probe",
		description: "test probe",
		parameters: ParamsSchema,
		execute,
	};
}

const ctx = {} as ExtensionContext;

test("strictTool sets constrainedSampling prefer by default; an authored value (incl. false) wins", () => {
	const wrapped = strictTool(makeTool(async () => ({ content: [], details: {} })));
	expect(wrapped.constrainedSampling).toEqual({ type: "json_schema", strict: "prefer" });

	const optedOut = strictTool({
		...makeTool(async () => ({ content: [], details: {} })),
		constrainedSampling: false as const,
	});
	expect(optedOut.constrainedSampling).toBe(false);
});

test("prepareArguments fills missing null-union keys (deep) without mutating the model's args", () => {
	const wrapped = strictTool(makeTool(async () => ({ content: [], details: {} })));
	const raw = { title: "t", options: [{ label: "a" }] };
	const prepared = wrapped.prepareArguments?.(raw) as Record<string, unknown>;
	expect(prepared).toEqual({
		title: "t",
		note: null,
		flag: null,
		options: [{ label: "a", preview: null }],
	});
	// The input (the transcript's toolCall.arguments) is untouched.
	expect(raw).toEqual({ title: "t", options: [{ label: "a" }] });
});

test("prepareArguments composes: an authored shim runs first, on the raw args", () => {
	const seen: unknown[] = [];
	const wrapped = strictTool({
		...makeTool(async () => ({ content: [], details: {} })),
		prepareArguments: (args) => {
			seen.push(args);
			return { ...(args as Record<string, unknown>), title: "rewritten" } as Params;
		},
	});
	const prepared = wrapped.prepareArguments?.({ title: "t" }) as Record<string, unknown>;
	expect(seen).toEqual([{ title: "t" }]);
	expect(prepared.title).toBe("rewritten");
	expect(prepared.note).toBeNull();
});

test("execute receives null-stripped params matching the ORIGINAL schema's optionals", async () => {
	let received: Params | undefined;
	const wrapped = strictTool(
		makeTool(async (_id, params) => {
			received = params;
			return { content: [], details: {} };
		}),
	);
	await wrapped.execute(
		"call-1",
		{
			title: "t",
			note: null,
			flag: null,
			options: [{ label: "a", preview: null }],
		} as never,
		undefined,
		undefined,
		ctx,
	);
	expect(received).toEqual({ title: "t", options: [{ label: "a" }] });
});
