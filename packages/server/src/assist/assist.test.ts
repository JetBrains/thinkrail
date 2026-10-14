import { afterEach, expect, test } from "bun:test";
import { type OneShotRunner, setOneShotRunner, suggestPlanSummary } from "./assist";

function fakeRunner(fn: OneShotRunner): void {
	setOneShotRunner(fn);
}

afterEach(() => setOneShotRunner(null));

test("suggestPlanSummary feeds the finished steps to the runner and returns the PR-body it emits verbatim", async () => {
	let seen = "";
	let seenSystem = "";
	fakeRunner(async (req) => {
		seen = req.prompt;
		seenSystem = req.system ?? "";
		return {
			text:
				"## Summary\n\nShipped the ranker rework.\n\n" +
				"## Changes\n\n_no cross-cutting notes_\n\n" +
				"## Testing\n\n- pytest \u2192 3 pass",
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
	expect(out).toBe(
		"## Summary\n\nShipped the ranker rework.\n\n" +
			"## Changes\n\n_no cross-cutting notes_\n\n" +
			"## Testing\n\n- pytest \u2192 3 pass",
	);
	expect(seen).toContain("Rework ranking");
	expect(seen).toContain("note: EV = P_accept");
	expect(seen).toContain("verified: pytest");
	expect(seen).toContain("Add logging");
	expect(seenSystem).toContain("## Summary");
	expect(seenSystem).toContain("## Changes");
	expect(seenSystem).toContain("## Testing");
});

test("suggestPlanSummary preserves H2 headings when stripping a code fence / 'Summary:' label; degrades to null on empty", async () => {
	fakeRunner(async () => ({
		text: "```md\nSummary: ## Summary\n\nAll done.\n\n## Changes\n\n_no cross-cutting notes_\n\n## Testing\n\n_not verified_\n```",
		model: { provider: "p", id: "m" },
	}));
	expect(await suggestPlanSummary([{ title: "Do it" }])).toBe(
		"## Summary\n\nAll done.\n\n## Changes\n\n_no cross-cutting notes_\n\n## Testing\n\n_not verified_",
	);
	fakeRunner(async () => ({ text: "   ", model: { provider: "p", id: "m" } }));
	expect(await suggestPlanSummary([{ title: "Do it" }])).toBeNull();
	fakeRunner(async () => {
		throw new Error("no auth");
	});
	expect(await suggestPlanSummary([{ title: "Do it" }])).toBeNull();
});

test("suggestPlanSummary normalizes model output that misses one or more required H2 sections", async () => {
	fakeRunner(async () => ({ text: "Done.", model: { provider: "p", id: "m" } }));
	const wrapped = await suggestPlanSummary([{ title: "step" }]);
	expect(wrapped).toBe(
		"## Summary\n\nDone.\n\n## Changes\n\n_no cross-cutting notes_\n\n## Testing\n\n_not verified_",
	);

	fakeRunner(async () => ({
		text: "## Summary\n\nShipped the thing.\n\n## Testing\n\n- unit \u2192 pass",
		model: { provider: "p", id: "m" },
	}));
	const reordered = await suggestPlanSummary([{ title: "step" }]);
	expect(reordered).toBe(
		"## Summary\n\nShipped the thing.\n\n## Changes\n\n_no cross-cutting notes_\n\n## Testing\n\n- unit \u2192 pass",
	);

	fakeRunner(async () => ({
		text: "Lead line.\n\n## Changes\n\n- a\n\n## Testing\n\n- unit \u2192 pass",
		model: { provider: "p", id: "m" },
	}));
	expect(await suggestPlanSummary([{ title: "step" }])).toBe(
		"## Summary\n\nLead line.\n\n## Changes\n\n- a\n\n## Testing\n\n- unit \u2192 pass",
	);

	fakeRunner(async () => ({
		text: "## Changes\n\n- a\n\n## Testing\n\n- unit \u2192 pass",
		model: { provider: "p", id: "m" },
	}));
	expect(await suggestPlanSummary([{ title: "step" }])).toBe(
		"## Summary\n\n_no summary_\n\n## Changes\n\n- a\n\n## Testing\n\n- unit \u2192 pass",
	);
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
