import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_701_100_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

const OFFER = [
	{ label: "Run the e2e suite", prompt: "Run the full e2e suite and report every failure." },
	{ label: "Open a pull request", prompt: "Open a pull request for this branch." },
	{
		label: "Explain the watcher debounce window in detail",
		prompt: "Explain how the watcher debounce window interacts with the poll interval.",
	},
];

async function stubPromptSends(page: Page, outcome: "ok" | "reject"): Promise<string[]> {
	const sent: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: { id?: string; method?: string; params?: { text?: string } };
			try {
				frame = JSON.parse(raw) as typeof frame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.method === "session.prompt" && frame.id) {
				sent.push(frame.params?.text ?? "");
				ws.send(
					JSON.stringify(
						outcome === "ok"
							? { id: frame.id, ok: true, result: { ok: true } }
							: { id: frame.id, ok: false, error: "prompt refused by the host" },
					),
				);
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
	return sent;
}

async function openOfferedChat(
	page: Page,
	opts: { items?: typeof OFFER; isError?: boolean } = {},
): Promise<void> {
	await openFixtureProject(page);
	seedWorkspaceSession(repoCwd(), {
		name: "next steps chat",
		messages: [
			{ role: "user", text: "summarize the watcher fix", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "I widened the debounce window so it no longer overlaps the poll interval.",
				toolCalls: [
					{ id: "call-offer", name: "offer_next_steps", arguments: { items: opts.items ?? OFFER } },
				],
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "call-offer",
				toolName: "offer_next_steps",
				text: "Offered 3 optional next step(s); the user may pick one:",
				details: { items: opts.items ?? OFFER },
				...(opts.isError ? { isError: true } : {}),
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

const chips = (page: Page): Locator => page.getByTestId("next-step-chip");

test.afterEach(() => {
	rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
});

test("the current offer renders as chips above the composer and leaves no transcript row", async ({
	page,
}) => {
	await openOfferedChat(page);

	const row = page.getByTestId("next-steps");
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-count", "3");
	await expect(chips(page)).toHaveCount(3);
	await expect(chips(page).nth(0)).toHaveText(OFFER[0]?.label ?? "");

	await expect(
		page.locator('[data-testid="activity-step"][data-tool="offer_next_steps"]'),
	).toHaveCount(0);
	await expect(page.locator('[data-testid="tool-card"][data-tool="offer_next_steps"]')).toHaveCount(
		0,
	);

	const rowBox = await row.boundingBox();
	const composerBox = await page.getByTestId("chat-input").boundingBox();
	if (!rowBox || !composerBox) throw new Error("expected both the chip row and the composer");
	expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(composerBox.y + 1);
});

test("a failed offer keeps the normal transcript fallback instead of chips", async ({ page }) => {
	await openOfferedChat(page, { isError: true });

	await expect(page.getByTestId("next-steps")).toHaveCount(0);
	await expect(
		page.locator('[data-testid="activity-step"][data-tool="offer_next_steps"]'),
	).toHaveCount(1);
});

test("the row is empty-draft only", async ({ page }) => {
	await openOfferedChat(page);
	const input = page.getByTestId("chat-input");

	await expect(page.getByTestId("next-steps")).toBeVisible();
	await input.fill("something of my own");
	await expect(page.getByTestId("next-steps")).toHaveCount(0);
	await input.fill("   ");
	await expect(page.getByTestId("next-steps")).toBeVisible();
	await input.fill("");
	await expect(page.getByTestId("next-steps")).toBeVisible();
});

test("clicking a chip sends its whole prompt immediately and makes the offer stale", async ({
	page,
}) => {
	const sent = await stubPromptSends(page, "ok");
	await openOfferedChat(page);

	await chips(page).nth(1).click();

	await expect.poll(() => sent).toEqual([OFFER[1]?.prompt]);
	await expect(page.getByTestId("chat-input")).toHaveValue("");
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]').last()).toContainText(
		OFFER[1]?.prompt ?? "",
	);
	await expect(page.getByTestId("next-steps")).toHaveCount(0);
});

test("a rejected send appends an error and does not revive the offer", async ({ page }) => {
	const sent = await stubPromptSends(page, "reject");
	await openOfferedChat(page);

	await chips(page).nth(0).click();

	await expect.poll(() => sent).toEqual([OFFER[0]?.prompt]);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="error"]').last(),
	).toContainText("prompt refused by the host");
	await expect(page.getByTestId("next-steps")).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toHaveValue("");
});

test("two activations in one task send exactly one prompt", async ({ page }) => {
	const sent = await stubPromptSends(page, "ok");
	await openOfferedChat(page);

	await page.evaluate(() => {
		const nodes = document.querySelectorAll<HTMLElement>('[data-testid="next-step-chip"]');
		nodes[0]?.click();
		nodes[0]?.click();
		nodes[1]?.click();
	});

	await expect.poll(() => sent).toEqual([OFFER[0]?.prompt]);
});

test("the bundled extension is wired into every session — /next-steps is offered", async ({
	page,
}) => {
	await openOfferedChat(page);
	const input = page.getByTestId("chat-input");

	await input.fill("/next-s");
	await expect(
		page
			.locator('[data-testid="slash-command"][data-source="extension"]')
			.filter({ hasText: "/next-steps" }),
	).toHaveCount(1);
});

test("at a phone width the chips wrap and nothing scrolls sideways", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openOfferedChat(page);

	const row = page.getByTestId("next-steps");
	await expect(row).toBeVisible();

	const layout = await row.evaluate((element) => {
		const tops = [...element.querySelectorAll<HTMLElement>('[data-testid="next-step-chip"]')].map(
			(chip) => chip.getBoundingClientRect().top,
		);
		return {
			lines: new Set(tops.map((top) => Math.round(top))).size,
			rowOverflow: element.scrollWidth - element.clientWidth,
			widest: Math.max(
				...[...element.querySelectorAll<HTMLElement>('[data-testid="next-step-chip"]')].map(
					(chip) => chip.getBoundingClientRect().width,
				),
			),
			available: element.clientWidth,
			pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
		};
	});

	expect(layout.lines).toBeGreaterThan(1);
	expect(layout.rowOverflow).toBeLessThanOrEqual(0);
	expect(layout.widest).toBeLessThanOrEqual(layout.available);
	expect(layout.pageOverflow).toBeLessThanOrEqual(0);
});
