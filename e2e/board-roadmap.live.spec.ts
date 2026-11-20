import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

interface TriageCard {
	id: string;
	category: string;
	blocks: string[];
	origin?: { sessionId?: string };
	roadmapProjectId?: string;
}

/** The fixture project's board cards, read from the host as the board answers them. */
async function boardCards(page: Page): Promise<TriageCard[]> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const [project] = await wire.request("project.list", {});
		if (!project) return [];
		const view = (await wire.request("extension.query", {
			extension: "board",
			method: "board.get",
			params: { projectId: project.id },
		})) as { cards: TriageCard[] };
		return view.cards;
	} finally {
		wire.close();
	}
}

test("Plan with agent decomposes an initiative into one linked group of cards in Triage", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(480_000);
	await page.setViewportSize({ width: 1720, height: 1000 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("view-rail-board:board").click();
	const board = page.getByTestId("board-main");
	await expect(board).toBeVisible();
	await board.getByTestId("board-view-roadmap").click();

	const now = board.locator('[data-testid="board-horizon"][data-horizon="now"]');
	await now.getByTestId("board-initiative-new").click();
	await now.getByTestId("board-initiative-new-title").fill("A greeting for new contributors");
	await now.getByTestId("board-initiative-new-title").press("Enter");
	const peek = page.getByTestId("peek-pane").getByTestId("board-initiative-panel");
	await expect(peek.getByTestId("board-initiative-title")).toHaveValue(
		"A greeting for new contributors",
	);
	await peek
		.getByTestId("board-initiative-outcome")
		.fill(
			"New contributors find a CONTRIBUTING.md that greets them and a README section linking to it.",
		);
	await peek.getByTestId("board-initiative-outcome").press("Tab");
	for (const criterion of [
		"CONTRIBUTING.md exists with a short greeting and how to run the project",
		"README.md links to CONTRIBUTING.md",
	]) {
		await peek.getByTestId("board-initiative-criteria-add").fill(criterion);
		await peek.getByTestId("board-initiative-criteria-add").press("Enter");
	}
	await expect(peek.getByTestId("board-initiative-criteria-item")).toHaveCount(2);

	await peek.getByTestId("board-initiative-chat-plan").click();
	await expect
		.poll(
			async () => (await boardCards(page)).filter((card) => card.category === "triage").length,
			{
				timeout: 420_000,
				intervals: [5_000],
			},
		)
		.toBeGreaterThanOrEqual(2);
	const triage = (await boardCards(page)).filter((card) => card.category === "triage");
	expect(new Set(triage.map((card) => card.origin?.sessionId)).size).toBe(1);
	const ids = new Set(triage.map((card) => card.id));
	expect(triage.some((card) => card.blocks.some((id) => ids.has(id)))).toBe(true);

	await page.getByTestId("view-rail-board:board").click();
	await expect(board).toBeVisible();
	await board.getByTestId("board-view-board").click();
	const lane = board.getByTestId("board-triage");
	await expect(lane.getByTestId("board-triage-toggle")).toContainText("Triage ·");
	await lane.getByTestId("board-triage-toggle").click();
	await expect(lane.getByTestId("board-triage-group")).toHaveCount(1);
	await expect(lane.getByTestId("board-triage-card")).toHaveCount(triage.length);
});
