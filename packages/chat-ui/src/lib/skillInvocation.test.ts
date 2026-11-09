import { expect, test } from "bun:test";
import { matchesSkillInvocationCommand, parseSkillInvocation } from "./skillInvocation";

const EXPANDED =
	'<skill name="review" location="/repo/.pi/skills/review/SKILL.md">\nReferences are relative to /repo/.pi/skills/review.\n\n# Review\n\nInspect the complete diff.\n</skill>\n\nFocus on src/app.ts.\nThen run tests.';

test("parses Pi's canonical expanded skill block and keeps the user request separate", () => {
	expect(parseSkillInvocation(EXPANDED)).toEqual({
		name: "review",
		location: "/repo/.pi/skills/review/SKILL.md",
		content:
			"References are relative to /repo/.pi/skills/review.\n\n# Review\n\nInspect the complete diff.",
		userMessage: "Focus on src/app.ts.\nThen run tests.",
	});
});

test("parses an invocation without arguments", () => {
	expect(
		parseSkillInvocation(
			'<skill name="todos" location="/skills/todos/SKILL.md">\nReferences are relative to /skills/todos.\n\nKeep the plan current.\n</skill>',
		),
	).toEqual({
		name: "todos",
		location: "/skills/todos/SKILL.md",
		content: "References are relative to /skills/todos.\n\nKeep the plan current.",
	});
});

test("fails closed for ordinary, quoted, prefixed, and malformed skill markup", () => {
	expect(parseSkillInvocation("please review this")).toBeNull();
	expect(parseSkillInvocation(`Quoted: ${EXPANDED}`)).toBeNull();
	expect(parseSkillInvocation(`prefix\n${EXPANDED}`)).toBeNull();
	expect(parseSkillInvocation(EXPANDED.replace("</skill>", "</skill-missing>"))).toBeNull();
});

test("matches only the raw slash command Pi expanded", () => {
	const invocation = parseSkillInvocation(EXPANDED);
	if (!invocation) throw new Error("fixture did not parse");

	expect(
		matchesSkillInvocationCommand(
			"/skill:review   Focus on src/app.ts.\nThen run tests.   ",
			invocation,
		),
	).toBe(true);
	expect(
		matchesSkillInvocationCommand("/skill:other Focus on src/app.ts.\nThen run tests.", invocation),
	).toBe(false);
	expect(matchesSkillInvocationCommand("/skill:review different request", invocation)).toBe(false);
	expect(
		matchesSkillInvocationCommand("review Focus on src/app.ts.\nThen run tests.", invocation),
	).toBe(false);
});

test("matches a no-argument command with Pi's trimmed trailing space", () => {
	const invocation = parseSkillInvocation(
		'<skill name="todos" location="/skills/todos/SKILL.md">\nbody\n</skill>',
	);
	if (!invocation) throw new Error("fixture did not parse");
	expect(matchesSkillInvocationCommand("/skill:todos ", invocation)).toBe(true);
});
