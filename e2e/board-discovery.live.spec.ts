import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

interface Score {
	score: number;
	reasons: string[];
	suggested: boolean;
}

interface DiscoveryIdea {
	id: string;
	value?: Score;
	effort?: Score;
	horizonSuggestion?: { horizon: string; reason: string };
}

/** The fixture project's discovery ideas, read from the host as the board answers them. */
async function ideas(page: Page): Promise<DiscoveryIdea[]> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const [project] = await wire.request("project.list", {});
		if (!project) return [];
		const view = (await wire.request("extension.query", {
			extension: "board",
			method: "discovery.get",
			params: { projectId: project.id },
		})) as { ideas: DiscoveryIdea[] };
		return view.ideas;
	} finally {
		wire.close();
	}
}

test("Analyze suggests an idea's value and effort, each with reasons", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(480_000);
	await page.setViewportSize({ width: 1720, height: 1000 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tool-rail-ext:board:board").click();
	const board = page.getByTestId("board-tool");
	await expect(board).toBeVisible();
	await board.getByTestId("board-view-roadmap").click();
	await board.getByTestId("board-roadmap-view-discovery").click();

	await board.getByTestId("board-idea-new").click();
	await board.getByTestId("board-idea-new-title").fill("A CONTRIBUTING guide for new contributors");
	await board.getByTestId("board-idea-new-title").press("Enter");
	const peek = page.getByTestId("peek-pane").getByTestId("board-idea-panel");
	await expect(peek.getByTestId("board-idea-title")).toHaveValue(
		"A CONTRIBUTING guide for new contributors",
	);
	const id = await peek.getAttribute("data-idea-id");
	await peek
		.getByTestId("board-idea-pitch")
		.fill(
			"First-time contributors cannot tell how to run the project; a short CONTRIBUTING.md linked from the README would tell them.",
		);
	await peek.getByTestId("board-idea-pitch").press("Tab");
	await peek.getByTestId("board-idea-evidence-kind").selectOption("note");
	await peek
		.getByTestId("board-idea-evidence-ref")
		.fill("Two newcomers asked in the chat how to run the tests this week.");
	await peek.getByTestId("board-idea-evidence-add").click();
	await expect(peek.getByTestId("board-idea-evidence")).toHaveCount(1);

	await peek.getByTestId("board-idea-chat-analyze").click();
	await expect
		.poll(
			async () => {
				const idea = (await ideas(page)).find((candidate) => candidate.id === id);
				return Boolean(idea?.value && idea.effort);
			},
			{ timeout: 420_000, intervals: [5_000] },
		)
		.toBe(true);
	const idea = (await ideas(page)).find((candidate) => candidate.id === id);
	for (const score of [idea?.value, idea?.effort]) {
		expect(score?.suggested).toBe(true);
		expect(score?.score).toBeGreaterThanOrEqual(1);
		expect(score?.score).toBeLessThanOrEqual(5);
		expect(score?.reasons.length).toBeGreaterThan(0);
	}
	await board.locator(`[data-testid="board-idea-row"][data-idea-id="${id}"] button`).click();
	await expect(peek).toHaveAttribute("data-idea-id", id ?? "");
	await expect(peek.getByTestId("board-idea-value-suggested")).toBeVisible();
	await expect(peek.getByTestId("board-idea-effort-confirm")).toBeVisible();
	await expect(
		board.locator(`[data-testid="board-discovery-dot"][data-idea-id="${id}"]`),
	).toHaveAttribute("data-suggested", "true");
});
