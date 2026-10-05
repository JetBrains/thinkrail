import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import {
	interceptAppWire,
	playStreamReplay,
	streamedMarkdown,
	textStreamReplay,
} from "./fixtures/streamReplay";

const BASE_TS = 1_700_900_000_000;
const CPU_THROTTLE = 4;
const FRAME_GAP_MS = 15;
const STREAM_CHARS = 25_000;
const SWITCH_AFTER_MS = 400;
const FIRST_VISIBLE_BUDGET_MS = 250;

interface ProbeFrame {
	t: number;
	mounted: boolean;
	shown: boolean;
	latestRowInView: boolean;
	edgeInView: boolean | null;
}

interface ProbeWindow {
	__streamMountProbe: { frames: ProbeFrame[]; stopped: boolean };
}

const installProbe = (page: Page, latestFirst: boolean) =>
	page.evaluate((newestFirst) => {
		const probe: ProbeWindow["__streamMountProbe"] = { frames: [], stopped: false };
		(window as unknown as ProbeWindow).__streamMountProbe = probe;
		const tick = () => {
			if (probe.stopped) return;
			const chat = [...document.querySelectorAll<HTMLElement>('[data-testid="chat-scroll"]')].find(
				(element) => element.offsetParent !== null,
			);
			const list = chat?.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]');
			const scroller = chat?.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
			const rows = [...(chat?.querySelectorAll<HTMLElement>('[data-testid="chat-row"]') ?? [])];
			const row = newestFirst ? rows[0] : rows.at(-1);
			const view = scroller?.getBoundingClientRect();
			const rect = row?.getBoundingClientRect();
			const edge = chat
				?.querySelector<HTMLElement>('[data-testid="chat-stream-edge"]')
				?.getBoundingClientRect();
			probe.frames.push({
				t: performance.now(),
				mounted: !!list,
				shown: !!list && list.style.visibility !== "hidden" && rows.length > 0,
				latestRowInView:
					!!view && !!rect && rect.bottom > view.top + 1 && rect.top < view.bottom - 1,
				edgeInView:
					view && edge ? edge.bottom >= view.top - 1 && edge.bottom <= view.bottom + 1 : null,
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, latestFirst);

const readProbe = (page: Page) =>
	page.evaluate(() => {
		const probe = (window as unknown as ProbeWindow).__streamMountProbe;
		probe.stopped = true;
		return probe.frames;
	});

const now = (page: Page) => page.evaluate(() => performance.now());

const selectNewestFirst = async (page: Page) => {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId("chat-order-newest-first");
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
};

const history = (exchanges: number) =>
	Array.from({ length: exchanges }, (_, turn) => [
		{ role: "user" as const, text: `Request ${turn}`, timestamp: BASE_TS + turn * 10_000 },
		{
			role: "assistant" as const,
			text: Array.from({ length: 6 }, (_, block) =>
				`Answer ${turn} paragraph ${block}. `.repeat(12),
			).join("\n\n"),
			timestamp: BASE_TS + turn * 10_000 + 1_000,
		},
	]).flat();

interface MountCase {
	order: "oldest-first" | "newest-first";
	mode: "tab-return" | "just-opened";
	viewport?: { width: number; height: number };
}

const cases: MountCase[] = [
	...(["oldest-first", "newest-first"] as const).flatMap((order) =>
		(["tab-return", "just-opened"] as const).map((mode) => ({ order, mode })),
	),
	{ order: "oldest-first", mode: "tab-return", viewport: { width: 1000, height: 560 } },
];

for (const { order, mode, viewport } of cases) {
	const size = viewport ? ` at ${viewport.width}x${viewport.height}` : "";
	test(`a ${mode} streaming chat stays visible in ${order} order${size}`, async ({ page }) => {
		test.setTimeout(120_000);
		if (viewport) await page.setViewportSize(viewport);
		const wire = await interceptAppWire(page);
		await openFixtureProject(page);
		if (order === "newest-first") await selectNewestFirst(page);
		const title = `stream mount ${order} ${mode}${size}`;
		const seeded = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: title,
			messages: history(4),
		});
		await enterDefaultWorkspace(page);
		const chatTab = page
			.locator('[data-testid="editor-tab"][data-kind="chat"]')
			.filter({ hasText: title });
		const chat = page.getByTestId("chat-scroll").filter({ visible: true });
		const replay = textStreamReplay(
			seeded.id,
			streamedMarkdown(title, STREAM_CHARS),
			BASE_TS + 100_000,
		);
		const cdp = await page.context().newCDPSession(page);
		try {
			if (mode === "tab-return") {
				await openPersistedChat(page, title);
				await expect(chat).toBeVisible();
			}
			await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
			await installProbe(page, order === "newest-first");
			let activatedAt = 0;
			if (mode === "just-opened") {
				await openPersistedChat(page, title);
				activatedAt = await now(page);
			}
			const stream = playStreamReplay(wire(), replay, FRAME_GAP_MS);
			if (mode === "tab-return") {
				await new Promise((resolve) => setTimeout(resolve, SWITCH_AFTER_MS));
				await page.getByTestId("new-chat").first().click();
				await expect(chatTab).not.toHaveAttribute("data-active", "true");
				await chatTab.click();
				await expect(chatTab).toHaveAttribute("data-active", "true");
				activatedAt = await now(page);
			}
			await stream;
			const streamDoneAt = await now(page);
			await expect(chat).toContainText(replay.finalTail, { timeout: 60_000 });
			await expect(chat).toHaveAttribute("data-streaming", "false", { timeout: 60_000 });
			const frames = (await readProbe(page)).filter(
				(frame) => frame.t >= activatedAt && frame.t <= streamDoneAt,
			);
			const mountedAt = frames.find((frame) => frame.mounted)?.t ?? Number.NaN;
			const firstShown = frames.findIndex((frame) => frame.shown);
			const first = frames[firstShown];
			expect(first, "transcript shown while streaming").toBeDefined();
			expect((first?.t ?? Number.POSITIVE_INFINITY) - mountedAt).toBeLessThanOrEqual(
				FIRST_VISIBLE_BUDGET_MS,
			);
			expect(first?.latestRowInView, "latest row in view on first shown frame").toBe(true);
			if (mode === "tab-return") {
				expect(first?.edgeInView, "stream edge in view on first shown frame").toBe(true);
			}
			const blankLater = frames.slice(firstShown).filter((frame) => !frame.shown).length;
			expect(blankLater, "blank frames after the transcript was shown").toBe(0);
		} finally {
			await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
		}
	});
}
