import { expect, type Page, test } from "@playwright/test";
import type { Container } from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

interface BoardCard {
	id: string;
	title: string;
	category: string;
	attempts: { workspaceId: string; sessionId: string }[];
}

interface Transition {
	to: { category: string } | null;
	actor: string;
	reason: string;
}

/** One request to the board's server half over the isolated host's wire. */
async function board<T>(page: Page, method: string, params: unknown): Promise<T> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return (await wire.request(
			"extension.query",
			{ extension: "board", method, params },
			60_000,
		)) as T;
	} finally {
		wire.close();
	}
}

async function containers(page: Page): Promise<Container[]> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return await wire.request("container.list", {});
	} finally {
		wire.close();
	}
}

async function cardOf(
	page: Page,
	cardId: string,
): Promise<BoardCard & { transitions: Transition[] }> {
	const detail = await board<{ card: BoardCard; transitions: Transition[] }>(page, "card.get", {
		cardId,
	});
	return { ...detail.card, transitions: detail.transitions };
}

test("autopilot: Run starts the first card, its completion readies the second, and the woken orchestrator starts it", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(900_000);
	await page.setViewportSize({ width: 1720, height: 1000 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	const [project] = await wire.request("project.list", {}).finally(() => wire.close());
	if (!project) throw new Error("the fixture project is not open");
	const projectId = project.id;

	const first = await board<BoardCard>(page, "card.create", {
		projectId,
		title: "Add a one-line usage example to README.md",
		description: "Append one short line to README.md showing how to run the project. Nothing else.",
		size: "S",
		column: "ready",
	});
	const second = await board<BoardCard>(page, "card.create", {
		projectId,
		title: "Add a one-line contributing note to README.md",
		description: "Append one short line to README.md inviting contributions. Nothing else.",
		size: "S",
		column: "ready",
	});
	await board(page, "card.link", { from: first.id, to: second.id });
	await board(page, "initiative.create", {
		projectId,
		title: "A friendlier README",
		outcome: "New readers see how to run the project and how to contribute.",
		criteria: ["README.md has a usage line", "README.md has a contributing line"],
		horizon: "now",
	});
	await board(page, "initiative.addCards", {
		projectId,
		initiativeId: "I-1",
		cardIds: [first.id, second.id],
	});

	const run = await board<{ containerId: string; started: { cardId: string } | null }>(
		page,
		"initiative.run",
		{ projectId, initiativeId: "I-1" },
	);
	expect(run.started?.cardId).toBe(first.id);
	await board(page, "initiative.autopilot", { projectId, initiativeId: "I-1", on: true });
	const ran = await cardOf(page, first.id);
	expect(ran.transitions.at(-1)).toMatchObject({
		actor: "automation",
		reason: "started by Run initiative I-1",
	});

	await expect
		.poll(async () => (await cardOf(page, first.id)).category, {
			timeout: 360_000,
			intervals: [5_000],
		})
		.toBe("review");
	expect((await cardOf(page, second.id)).attempts).toHaveLength(0);
	await board(page, "card.move", { cardId: first.id, column: "done" });

	await expect
		.poll(async () => (await cardOf(page, second.id)).attempts.length, {
			timeout: 420_000,
			intervals: [5_000],
		})
		.toBe(1);
	const started = await cardOf(page, second.id);
	expect(["started", "review"]).toContain(started.category);
	expect(started.transitions.find((entry) => entry.to?.category === "started")).toMatchObject({
		actor: "automation",
		reason: expect.stringContaining("started by the orchestrator of the container"),
	});
	const container = (await containers(page)).find((entry) => entry.id === run.containerId);
	expect(container?.workspaceIds).toEqual([
		(await cardOf(page, first.id)).attempts[0]?.workspaceId,
		started.attempts[0]?.workspaceId,
	]);
	expect(container?.orchestratorSessionId).toBeTruthy();
});
