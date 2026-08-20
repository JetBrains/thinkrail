import { expect, test } from "bun:test";
import { assembleTemplate, stripFrontmatter } from "./templateText";

test("no frontmatter at all: content that doesn't start with --- is the body untouched, no trimming", () => {
	const content = "\n  leading whitespace and a blank line\nBody text\n  ";
	expect(stripFrontmatter(content)).toBe(content);
});

test("an opener with no closing fence: the whole content is body, completely untouched (not even trimmed)", () => {
	const content = "---\ndescription: never closes\nstill going\n\n";
	expect(stripFrontmatter(content)).toBe(content);
});

test("closing fence found: the body is trimmed of ALL leading/trailing blank lines, not just one \\n", () => {
	const content = '---\ndescription: "d"\n---\n\n\nBody text\n\n';
	expect(stripFrontmatter(content)).toBe("Body text");
});

test("an empty frontmatter block (--- / ---) still finds the fence and trims the body", () => {
	const content = "---\n---\n\nBody text\n";
	expect(stripFrontmatter(content)).toBe("Body text");
});

test("the boundary rule is style-blind: single-quoted and block-scalar frontmatter never leak into the body", () => {
	const singleQuoted = "---\ndescription: 'Review safely'\n---\nBody";
	expect(stripFrontmatter(singleQuoted)).toBe("Body");
	const blockScalar = "---\ndescription: >\n  folded description\n  over two lines\n---\nBody";
	expect(stripFrontmatter(blockScalar)).toBe("Body");
});

test("real fixture compatibility: e2e/fixtures/templates.ts's review.md (one \\n after the fence, bare description, quoted argument-hint) splits correctly", () => {
	const content = `---\ndescription: Review a file for issues\nargument-hint: "[file] [scope]"\n---\nReview $1 for issues, focusing on \${2:-src/}.\n`;
	expect(stripFrontmatter(content)).toBe(`Review $1 for issues, focusing on \${2:-src/}.`);
});

test("omits the frontmatter block entirely when both fields are empty and the body doesn't start with ---", () => {
	expect(assembleTemplate("", "", "plain body")).toBe("plain body");
});

test("a body starting with --- gets an explicit (empty) wrapper even with no keys set, and round-trips exactly", () => {
	const body = "---\nMeeting notes\n---\nAfter the second fence";
	const assembled = assembleTemplate("", "", body);
	expect(assembled).toBe(`---\n---\n\n${body}`);
	expect(stripFrontmatter(assembled)).toBe(body);
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

function bodyRoundTrips(description: string, argumentHint: string, body: string) {
	expect(stripFrontmatter(assembleTemplate(description, argumentHint, body))).toBe(body);
}

test("round-trip: plain body, both fields set", () => {
	bodyRoundTrips("A description", "[file]", "Do the thing.");
});

test("round-trip: empty description/argument-hint combos", () => {
	bodyRoundTrips("", "", "Body only.");
	bodyRoundTrips("Only description", "", "Body.");
	bodyRoundTrips("", "Only hint", "Body.");
});

test("round-trip: a body with no wrapper at all preserves its own leading blank line exactly", () => {
	bodyRoundTrips("", "", "\nBody with a leading blank line, no wrapper needed");
});

test("round-trip: --- mid-body (real frontmatter present) never confuses the boundary search", () => {
	bodyRoundTrips("d", "", "before\n---\nlooks like a fence\n---\nafter");
});

test("round-trip: body starting with --- and no keys set survives even with embedded fence-looking lines", () => {
	bodyRoundTrips("", "", "---\nfake: frontmatter\n---\nreal body");
});

test("round-trip: multi-line body with no leading/trailing whitespace of its own", () => {
	bodyRoundTrips("d", "h", "line one\nline two");
});

test("a body's own leading blank lines survive with no frontmatter at all, but are trimmed away once any frontmatter block wraps it — matching pi's real .trim()-based boundary rule exactly, not a bug", () => {
	const body = "\n\nBody with two leading blank lines";
	expect(stripFrontmatter(assembleTemplate("", "", body))).toBe(body);
	expect(stripFrontmatter(assembleTemplate("d", "", body))).toBe(
		"Body with two leading blank lines",
	);
});

test("re-splitting an already-split-and-reassembled template never grows the body, even starting from a hand-authored single-\\n file", () => {
	const original = "---\ndescription: Bare value\n---\nBody text";
	const once = stripFrontmatter(original);
	expect(once).toBe("Body text");

	const reassembled = assembleTemplate("Bare value", "", once);
	expect(reassembled).toBe('---\ndescription: "Bare value"\n---\n\nBody text');
	expect(stripFrontmatter(reassembled)).toBe("Body text");

	const reassembledAgain = assembleTemplate("Bare value", "", stripFrontmatter(reassembled));
	expect(reassembledAgain).toBe(reassembled);
	expect(stripFrontmatter(reassembledAgain)).toBe("Body text");
});

test("editing only the description across repeated save cycles leaves the body byte-for-byte unchanged", () => {
	const original = assembleTemplate("first description", "", "Notes for the day");
	expect(stripFrontmatter(original)).toBe("Notes for the day");

	const firstSave = assembleTemplate("revised once", "", stripFrontmatter(original));
	expect(stripFrontmatter(firstSave)).toBe("Notes for the day");

	const secondSave = assembleTemplate("revised twice", "", stripFrontmatter(firstSave));
	expect(stripFrontmatter(secondSave)).toBe("Notes for the day");
});
