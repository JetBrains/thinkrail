import { afterEach, expect, test } from "bun:test";
import { type OneShotRunner, setOneShotRunner, suggestPlanSummary } from "./assist";

function fakeRunner(fn: OneShotRunner): void {
	setOneShotRunner(fn);
}

afterEach(() => setOneShotRunner(null));

test("suggestPlanSummary feeds the finished steps to the runner and returns markdown prose", async () => {
	let seen = "";
	fakeRunner(async (req) => {
		seen = req.prompt;
		return {
			text: "Shipped the ranker rework.\n\n- EV ranking\n- feature logging",
			model: { provider: "p", id: "m" },
		};
	});
	const out = await suggestPlanSummary([
		{
			title: "Rework ranking",
			summary: "EV = P_accept \u00d7 value",
			verification: "pytest \u2192 3 pass",
		},
		{ title: "Add logging" },
	]);
	expect(out).toBe("Shipped the ranker rework.\n\n- EV ranking\n- feature logging");
	expect(seen).toContain("Rework ranking");
	expect(seen).toContain("note: EV = P_accept");
	expect(seen).toContain("verified: pytest");
	expect(seen).toContain("Add logging");
});

test("suggestPlanSummary strips a code fence / 'Summary:' label and degrades to null", async () => {
	fakeRunner(async () => ({
		text: "```md\nSummary: All done.\n```",
		model: { provider: "p", id: "m" },
	}));
	expect(await suggestPlanSummary([{ title: "Do it" }])).toBe("All done.");
	fakeRunner(async () => ({ text: "   ", model: { provider: "p", id: "m" } }));
	expect(await suggestPlanSummary([{ title: "Do it" }])).toBeNull();
	fakeRunner(async () => {
		throw new Error("no auth");
	});
	expect(await suggestPlanSummary([{ title: "Do it" }])).toBeNull();
});

test("suggestPlanSummary returns null without calling the runner when there are no usable steps", async () => {
	let called = false;
	fakeRunner(async () => {
		called = true;
		return { text: "x", model: { provider: "p", id: "m" } };
	});
	expect(await suggestPlanSummary([{ title: "   " }])).toBeNull();
	expect(called).toBe(false);
});
