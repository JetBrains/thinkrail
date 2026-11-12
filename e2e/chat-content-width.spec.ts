import { realpathSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { clickTranscriptControl } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_930_000_000;
const CHAT_NAME = "content width chat";
const WIDE_LINE = `const route = [${Array.from({ length: 60 }, (_, i) => `"segment-${i}"`).join(", ")}];`;
const NARROW_LINE = "const ok = true;";
const WIDE_OUTPUT = Array.from({ length: 40 }, (_, i) => `column-${i}`).join("\t");
const WIDE_DIAGRAM = `flowchart LR\n  ${Array.from({ length: 16 }, (_, i) => `step${i}[Pipeline stage ${i}]`).join(" --> ")}`;

const ASSISTANT_TEXT = [
	"Here is the route table and a short check.",
	"",
	"```ts",
	WIDE_LINE,
	"```",
	"",
	"```ts",
	NARROW_LINE,
	"```",
].join("\n");

function seedTranscript(): void {
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: CHAT_NAME,
		messages: [
			{ role: "user", text: "Show me the wide output.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{ type: "text", text: ASSISTANT_TEXT },
					{
						type: "toolCall",
						id: "bash-wide",
						name: "bash",
						arguments: { command: "cat wide.tsv" },
					},
					{ type: "toolCall", id: "bash-narrow", name: "bash", arguments: { command: "echo ok" } },
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "bash-wide",
				toolName: "bash",
				content: [{ type: "text", text: WIDE_OUTPUT }],
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
			{
				role: "toolResult",
				toolCallId: "bash-narrow",
				toolName: "bash",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: BASE_TS + 3_000,
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "visualize-wide",
						name: "visualize",
						arguments: { type: "diagram", title: "Pipeline", mermaid: WIDE_DIAGRAM },
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 4_000,
			},
			{
				role: "toolResult",
				toolCallId: "visualize-wide",
				toolName: "visualize",
				content: [{ type: "text", text: "Visualization complete." }],
				details: { type: "diagram", title: "Pipeline", mermaid: WIDE_DIAGRAM },
				isError: false,
				timestamp: BASE_TS + 5_000,
			},
			{ role: "assistant", text: "Done.", stopReason: "stop", timestamp: BASE_TS + 6_000 },
		],
	});
}

interface Geometry {
	left: number;
	right: number;
	parentLeft: number;
	parentRight: number;
	columnLeft: number;
	columnRight: number;
	paneLeft: number;
	paneRight: number;
	gutter: number;
}

function geometry(block: Locator): Promise<Geometry> {
	return block.evaluate((element) => {
		const row = element.closest('[data-testid="chat-row"]');
		const scroller = element.closest("[data-virtuoso-scroller]");
		const parent = element.parentElement;
		if (!(row instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !parent) {
			throw new Error("block is not inside a transcript row");
		}
		const contentBox = (box: HTMLElement) => {
			const rect = box.getBoundingClientRect();
			const style = getComputedStyle(box);
			return {
				left:
					rect.left +
					Number.parseFloat(style.borderLeftWidth) +
					Number.parseFloat(style.paddingLeft),
				right:
					rect.right -
					Number.parseFloat(style.borderRightWidth) -
					Number.parseFloat(style.paddingRight),
			};
		};
		const box = element.getBoundingClientRect();
		const column = contentBox(row);
		const parentBox = contentBox(parent);
		const paneLeft = scroller.getBoundingClientRect().left + scroller.clientLeft;
		return {
			left: box.left,
			right: box.right,
			parentLeft: parentBox.left,
			parentRight: parentBox.right,
			columnLeft: column.left,
			columnRight: column.right,
			paneLeft,
			paneRight: paneLeft + scroller.clientWidth,
			gutter: Number.parseFloat(getComputedStyle(row).paddingLeft),
		};
	});
}

async function expectCenteredBreakout(block: Locator): Promise<void> {
	await expect
		.poll(async () => {
			const g = await geometry(block);
			return {
				grewPastColumn: g.right - g.left > g.columnRight - g.columnLeft + 1,
				fillsPane:
					Math.abs(g.left - (g.paneLeft + g.gutter)) <= 1 &&
					Math.abs(g.right - (g.paneRight - g.gutter)) <= 1,
				centeredOnColumn:
					Math.abs((g.left + g.right) / 2 - (g.columnLeft + g.columnRight) / 2) <= 1,
			};
		})
		.toEqual({ grewPastColumn: true, fillsPane: true, centeredOnColumn: true });
}

async function expectWithinPane(block: Locator): Promise<void> {
	await expect
		.poll(async () => {
			const g = await geometry(block);
			return {
				grewPastParent: g.right - g.left > g.parentRight - g.parentLeft + 1,
				withinPane: g.left >= g.paneLeft + g.gutter - 1 && g.right <= g.paneRight - g.gutter + 1,
			};
		})
		.toEqual({ grewPastParent: true, withinPane: true });
}

async function expectParentWidth(block: Locator): Promise<void> {
	await expect
		.poll(async () => {
			const g = await geometry(block);
			return Math.max(Math.abs(g.left - g.parentLeft), Math.abs(g.right - g.parentRight));
		})
		.toBeLessThanOrEqual(1);
}

async function expandTranscriptDisclosure(toggle: Locator): Promise<void> {
	if ((await toggle.getAttribute("aria-expanded")) !== "true") await clickTranscriptControl(toggle);
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function setFitToPane(page: Page, bounded: boolean): Promise<void> {
	if (!(await page.getByTestId("settings-dialog").isVisible())) {
		await page.getByTestId("open-settings").click();
	}
	await page.getByTestId("settings-nav-chat").click();
	const control = page.getByTestId("chat-line-width-bounded");
	if ((await control.getAttribute("data-active")) !== String(bounded)) {
		await control.click();
		await expect(control).toHaveAttribute("data-active", String(bounded));
	}
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

test("wide code blocks and tool results grow past the chat column only while it fits the pane", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await openFixtureProject(page);
	seedTranscript();
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, CHAT_NAME);
	await hideAuxiliaryWorkbench(page);

	const assistant = page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.filter({ hasText: "route table" });
	const wideCode = assistant.locator("pre").filter({ hasText: "segment-59" }).first();
	const narrowCode = assistant.locator("pre").filter({ hasText: NARROW_LINE }).first();
	const card = page.locator('[data-testid="tool-card"][data-tool="visualize"]');
	await expect(card).toHaveAttribute("data-expanded", "true");
	await expect(card.getByTestId("mermaid-svg").locator("svg")).toBeVisible({ timeout: 20_000 });
	const group = page.getByTestId("activity-group");
	await expandTranscriptDisclosure(group.getByTestId("activity-group-toggle"));
	const wideStep = group.locator('[data-testid="activity-step"]').first();
	await expandTranscriptDisclosure(wideStep.getByTestId("activity-step-toggle"));
	const wideOutput = wideStep.getByTestId("tool-bash").locator("xpath=..");

	try {
		await expectCenteredBreakout(wideCode);
		await expectCenteredBreakout(card);
		await expectWithinPane(wideOutput);
		await expectParentWidth(narrowCode);
		await expect
			.poll(() => wideOutput.locator("pre").evaluate((pre) => pre.scrollWidth > pre.clientWidth))
			.toBe(true);

		await setFitToPane(page, false);
		for (const block of [wideCode, card, wideOutput, narrowCode]) await expectParentWidth(block);
	} finally {
		await setFitToPane(page, true).catch(() => {});
	}
});
