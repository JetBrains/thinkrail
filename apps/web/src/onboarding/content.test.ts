import { expect, test } from "bun:test";
import { DEMO_FILES, GAME_BEATS, RECAP, REVEAL_COPY, scoreLine } from "./content";

test("the game has exactly five beats in the spec'd order", () => {
	expect(GAME_BEATS.map((b) => b.id)).toEqual([
		"carries",
		"location",
		"environment",
		"history",
		"payoff",
	]);
});

test("beat 1 is the tap beat and its answer set is exactly the committed files", () => {
	const beat = GAME_BEATS[0];
	if (beat?.kind !== "tap") throw new Error("beat 1 must be the tap beat");
	const committed = DEMO_FILES.filter((f) => f.status === "committed" || f.status === "modified");
	expect([...beat.answers].sort()).toEqual(committed.map((f) => f.path).sort());
	// The lesson's stayers are present and NOT in the answer set.
	for (const path of [".env", "notes.todo", "node_modules/"]) {
		expect(DEMO_FILES.some((f) => f.path === path)).toBe(true);
		expect(beat.answers.includes(path)).toBe(false);
	}
});

test("every choice beat's correct choice exists and every beat teaches (nonempty whyline)", () => {
	for (const beat of GAME_BEATS) {
		expect(beat.whyline.length).toBeGreaterThan(0);
		if (beat.kind === "choice") {
			expect(beat.choices.some((c) => c.id === beat.correctId)).toBe(true);
			expect(beat.choices.length).toBeGreaterThanOrEqual(2);
		}
	}
});

test("recap has three bullets and the score line never shames", () => {
	expect(RECAP).toHaveLength(3);
	for (const n of [0, 1, 2, 3, 4, 5]) expect(scoreLine(n)).not.toMatch(/wrong|fail/i);
});

test("REVEAL_COPY covers every ChoiceBeat reveal kind used by the game", () => {
	for (const beat of GAME_BEATS) {
		if (beat.kind !== "choice") continue;
		expect(Object.hasOwn(REVEAL_COPY, beat.reveal)).toBe(true);
		expect(REVEAL_COPY[beat.reveal]).toBeTruthy();
	}
});
