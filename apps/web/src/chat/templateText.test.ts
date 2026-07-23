import { expect, test } from "bun:test";
import { assembleTemplate, splitTemplate, stripFrontmatter } from "./templateText";

// ---- splitTemplate / stripFrontmatter: boundary-finding, pinned to pi's extractFrontmatter ----

test("no frontmatter at all: content that doesn't start with --- is the body untouched, no trimming", () => {
	const content = "\n  leading whitespace and a blank line\nBody text\n  ";
	expect(splitTemplate(content)).toEqual({ description: "", argumentHint: "", body: content });
	expect(stripFrontmatter(content)).toBe(content);
});

test("an opener with no closing fence: the whole content is body, completely untouched (not even trimmed)", () => {
	const content = "---\ndescription: never closes\nstill going\n\n";
	expect(splitTemplate(content)).toEqual({ description: "", argumentHint: "", body: content });
	expect(stripFrontmatter(content)).toBe(content);
});

test("closing fence found: the body is trimmed of ALL leading/trailing blank lines, not just one \\n", () => {
	const content = '---\ndescription: "d"\n---\n\n\nBody text\n\n';
	const parsed = splitTemplate(content);
	expect(parsed.description).toBe("d");
	expect(parsed.body).toBe("Body text");
});

test("an empty frontmatter block (--- / ---) still finds the fence and trims the body", () => {
	const content = "---\n---\n\nBody text\n";
	expect(splitTemplate(content)).toEqual({ description: "", argumentHint: "", body: "Body text" });
});

test("reads both a JSON.stringify-quoted value and a bare (hand-authored) scalar value", () => {
	const quoted = '---\ndescription: "Quoted value"\nargument-hint: "[a] [b]"\n---\nBody';
	expect(splitTemplate(quoted)).toEqual({
		description: "Quoted value",
		argumentHint: "[a] [b]",
		body: "Body",
	});
	const bare = "---\ndescription: Bare value\n---\nBody";
	expect(splitTemplate(bare)).toEqual({
		description: "Bare value",
		argumentHint: "",
		body: "Body",
	});
});

test("real fixture compatibility: e2e/fixtures/templates.ts's review.md (one \\n after the fence, bare description, quoted argument-hint) splits correctly", () => {
	const content =
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal pi placeholder syntax in a fixture string, not a template placeholder
		'---\ndescription: Review a file for issues\nargument-hint: "[file] [scope]"\n---\nReview $1 for issues, focusing on ${2:-src/}.\n';
	const parsed = splitTemplate(content);
	expect(parsed.description).toBe("Review a file for issues");
	expect(parsed.argumentHint).toBe("[file] [scope]");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal pi placeholder syntax being asserted on, not a template placeholder
	expect(parsed.body).toBe("Review $1 for issues, focusing on ${2:-src/}.");
});

test("stripFrontmatter (ChatView's composer-pick path) agrees with splitTemplate's body for the same content", () => {
	const content = '---\ndescription: "d"\n---\n\nBody\n';
	expect(stripFrontmatter(content)).toBe(splitTemplate(content).body);
});

// ---- assembleTemplate: the inverse, and the forced-wrapper fix for ----leading bodies ----

test("omits the frontmatter block entirely when both fields are empty and the body doesn't start with ---", () => {
	expect(assembleTemplate("", "", "plain body")).toBe("plain body");
});

test("a body starting with --- gets an explicit (empty) wrapper even with no keys set, and round-trips exactly", () => {
	// The ambiguous case: saved bare, this body's OWN embedded --- lines would later be misread as a (junk)
	// frontmatter block by any splitter that mirrors pi's real algorithm — silent data loss. Forcing an
	// explicit wrapper sidesteps it unconditionally, since our own fence is always the earliest "\n---".
	const body = "---\nMeeting notes\n---\nAfter the second fence";
	const assembled = assembleTemplate("", "", body);
	expect(assembled).toBe(`---\n---\n\n${body}`);
	expect(splitTemplate(assembled)).toEqual({ description: "", argumentHint: "", body });
});

test("emits only the keys with non-empty values", () => {
	expect(assembleTemplate("d", "", "body")).toBe('---\ndescription: "d"\n---\n\nbody');
	expect(assembleTemplate("", "h", "body")).toBe('---\nargument-hint: "h"\n---\n\nbody');
	expect(assembleTemplate("d", "h", "body")).toBe(
		'---\ndescription: "d"\nargument-hint: "h"\n---\n\nbody',
	);
});

test("trims description/argument-hint before deciding whether they're empty", () => {
	expect(assembleTemplate("   ", "  ", "body")).toBe("body");
});

// ---- round-trip identity: assemble -> split is the identity on (desc, hint, body) ----

function roundTrips(description: string, argumentHint: string, body: string) {
	const assembled = assembleTemplate(description, argumentHint, body);
	const parsed = splitTemplate(assembled);
	expect(parsed.description).toBe(description.trim());
	expect(parsed.argumentHint).toBe(argumentHint.trim());
	expect(parsed.body).toBe(body);
}

test("round-trip: plain body, both fields set", () => {
	roundTrips("A description", "[file]", "Do the thing.");
});

test("round-trip: empty description/argument-hint combos", () => {
	roundTrips("", "", "Body only.");
	roundTrips("Only description", "", "Body.");
	roundTrips("", "Only hint", "Body.");
});

test("round-trip: a body with no wrapper at all preserves its own leading blank line exactly", () => {
	roundTrips("", "", "\nBody with a leading blank line, no wrapper needed");
});

test("round-trip: --- mid-body (real frontmatter present) never confuses the boundary search", () => {
	roundTrips("d", "", "before\n---\nlooks like a fence\n---\nafter");
});

test("round-trip: body starting with --- and no keys set survives even with embedded fence-looking lines", () => {
	roundTrips("", "", "---\nfake: frontmatter\n---\nreal body");
});

test("round-trip: multi-line body with no leading/trailing whitespace of its own", () => {
	roundTrips("d", "h", "line one\nline two");
});

// ---- pi-semantics pin: what survives vs what pi's own .trim() rule discards ----

test("a body's own leading blank lines survive with no frontmatter at all, but are trimmed away once any frontmatter block wraps it — matching pi's real .trim()-based boundary rule exactly, not a bug", () => {
	const body = "\n\nBody with two leading blank lines";
	// No wrapper (empty desc/hint, body doesn't start with "---"): the whole file IS the body, untouched.
	expect(splitTemplate(assembleTemplate("", "", body)).body).toBe(body);
	// A wrapper forces the boundary through `.trim()`, same as pi's own extractFrontmatter — the leading
	// blank lines are indistinguishable from the block separator and don't survive. This is intentional:
	// pi's own loader would produce the exact same trimmed body for this exact file, frontmatter and all.
	expect(splitTemplate(assembleTemplate("d", "", body)).body).toBe(
		"Body with two leading blank lines",
	);
});

// ---- stability: split(assemble(split(x))) must not compound (the reviewer's second bug) ----

test("re-splitting an already-split-and-reassembled template never grows the body, even starting from a hand-authored single-\\n file", () => {
	const original = "---\ndescription: Bare value\n---\nBody text";
	const once = splitTemplate(original);
	expect(once.body).toBe("Body text");

	const reassembled = assembleTemplate(once.description, once.argumentHint, once.body);
	// Our own assembler always normalizes to the canonical two-`\n` separator...
	expect(reassembled).toBe('---\ndescription: "Bare value"\n---\n\nBody text');
	const twice = splitTemplate(reassembled);
	expect(twice.body).toBe("Body text");

	// ...and a second save from there is a byte-identical fixed point — not one more leaked `\n`.
	const reassembledAgain = assembleTemplate(twice.description, twice.argumentHint, twice.body);
	expect(reassembledAgain).toBe(reassembled);
	expect(splitTemplate(reassembledAgain).body).toBe("Body text");
});

test("editing only the description across repeated save cycles leaves the body byte-for-byte unchanged", () => {
	// The exact reviewer-flagged regression: TemplateEditorDialog's edit flow re-saves `parsed.body`
	// verbatim every time the user only touches the description field.
	const original = assembleTemplate("first description", "", "Notes for the day");
	let parsed = splitTemplate(original);
	expect(parsed.body).toBe("Notes for the day");

	const firstSave = assembleTemplate("revised once", parsed.argumentHint, parsed.body);
	parsed = splitTemplate(firstSave);
	expect(parsed.body).toBe("Notes for the day");

	const secondSave = assembleTemplate("revised twice", parsed.argumentHint, parsed.body);
	parsed = splitTemplate(secondSave);
	expect(parsed.body).toBe("Notes for the day");
});
