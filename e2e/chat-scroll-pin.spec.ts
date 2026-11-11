import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { moveMouseToChatViewport } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import {
	interceptAppWire,
	playStreamReplay,
	streamedMarkdown,
	textStreamReplay,
} from "./fixtures/streamReplay";

const BASE_TS = 1_700_960_000_000;
const FRAME_GAP_MS = 15;
const STREAM_CHARS = 6_000;
const PIN_TOLERANCE_PX = 2;
const BACKWARD_TOLERANCE_PX = 1;
const MIN_PINNED_SAMPLES = 20;

interface PinSample {
	scrollTop: number;
	viewportHeight: number;
	edge: number | null;
	streaming: boolean;
	following: boolean;
}

interface PinWindow {
	__pinSamples: PinSample[];
}

const installSampler = (page: Page) =>
	page.evaluate(() => {
		const samples: PinSample[] = [];
		(window as unknown as PinWindow).__pinSamples = samples;
		const chat = [...document.querySelectorAll<HTMLElement>('[data-testid="chat-scroll"]')].find(
			(element) => element.offsetParent !== null,
		);
		const scroller = chat?.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
		const list = scroller?.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]');
		if (!chat || !scroller || !list) throw new Error("The chat transcript is not mounted");
		new ResizeObserver(() => {
			const top = scroller.getBoundingClientRect().top;
			const edge = chat.querySelector<HTMLElement>('[data-testid="chat-stream-edge"]');
			samples.push({
				scrollTop: scroller.scrollTop,
				viewportHeight: scroller.clientHeight,
				edge: edge ? edge.getBoundingClientRect().bottom - top : null,
				streaming: chat.dataset.streaming === "true",
				following: chat.dataset.followState === "following",
			});
		}).observe(list);
	});

const history = (exchanges: number) =>
	Array.from({ length: exchanges }, (_, turn) => [
		{ role: "user" as const, text: `Request ${turn}`, timestamp: BASE_TS + turn * 10_000 },
		{
			role: "assistant" as const,
			text: `Answer ${turn}. `.repeat(40),
			timestamp: BASE_TS + turn * 10_000 + 1_000,
		},
	]).flat();

test("a following reader's streaming edge stays on the pin line after every layout pass", async ({
	page,
}) => {
	const wire = await interceptAppWire(page);
	await openFixtureProject(page);
	const title = "stream pin";
	const seeded = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: title,
		messages: history(2),
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	const chat = page.getByTestId("chat-scroll").filter({ visible: true });
	await expect(chat).toBeVisible();
	await installSampler(page);

	const replay = textStreamReplay(
		seeded.id,
		streamedMarkdown(title, STREAM_CHARS),
		BASE_TS + 100_000,
	);
	await playStreamReplay(wire(), replay, FRAME_GAP_MS);
	await expect(chat).toContainText(replay.finalTail);
	await expect(chat).toHaveAttribute("data-streaming", "false");

	const samples = (await page.evaluate(() => (window as unknown as PinWindow).__pinSamples)).filter(
		(sample) => sample.streaming && sample.following && sample.edge !== null,
	);
	const reached = samples.findIndex(
		(sample) => (sample.edge ?? 0) >= sample.viewportHeight - PIN_TOLERANCE_PX,
	);
	expect(reached, "stream edge reaches the pin line").toBeGreaterThanOrEqual(0);
	const pinned = samples.slice(reached);
	expect(pinned.length).toBeGreaterThanOrEqual(MIN_PINNED_SAMPLES);
	const offLine = pinned.filter(
		(sample) => Math.abs((sample.edge ?? 0) - sample.viewportHeight) > PIN_TOLERANCE_PX,
	);
	expect(offLine, "samples with the edge off the pin line").toEqual([]);
	const backward = pinned.filter(
		(sample, index) =>
			index > 0 && sample.scrollTop < (pinned[index - 1]?.scrollTop ?? 0) - BACKWARD_TOLERANCE_PX,
	);
	expect(backward, "samples where scrollTop moved backward").toEqual([]);
});

test("a reader who wheels up while the edge is pinned detaches and the text under them stays put", async ({
	page,
}) => {
	const wire = await interceptAppWire(page);
	await openFixtureProject(page);
	const title = "stream detach";
	const seeded = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: title,
		messages: history(2),
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	const chat = page.getByTestId("chat-scroll").filter({ visible: true });
	await expect(chat).toBeVisible();

	const replay = textStreamReplay(
		seeded.id,
		streamedMarkdown(title, STREAM_CHARS),
		BASE_TS + 100_000,
	);
	const streaming = playStreamReplay(wire(), replay, FRAME_GAP_MS);
	await expect
		.poll(() =>
			chat.evaluate((root) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				return scroller !== null && scroller.scrollHeight > scroller.clientHeight + 300;
			}),
		)
		.toBe(true);
	await expect(chat).toHaveAttribute("data-follow-state", "following");

	await moveMouseToChatViewport(page, chat);
	for (let notch = 0; notch < 4; notch += 1) await page.mouse.wheel(0, -150);
	await expect(chat).toHaveAttribute("data-follow-state", "detached");
	await expect(chat).toHaveAttribute("data-streaming", "true");
	await chat.evaluate(
		(root) =>
			new Promise<void>((resolve) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				let last = scroller.scrollTop;
				let still = 0;
				const frame = () => {
					still = scroller.scrollTop === last ? still + 1 : 0;
					last = scroller.scrollTop;
					if (still >= 3) resolve();
					else requestAnimationFrame(frame);
				};
				requestAnimationFrame(frame);
			}),
	);
	const anchor = await chat.evaluate((root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("missing Virtuoso scroller");
		const viewport = scroller.getBoundingClientRect();
		const middle = viewport.top + viewport.height / 2;
		const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find((candidate) => {
			const rect = candidate.getBoundingClientRect();
			return rect.top <= middle && rect.bottom >= middle;
		});
		const id = row?.getAttribute("data-chat-row-id");
		if (!row || !id) throw new Error("no chat row intersects the viewport middle");
		return { id, top: row.getBoundingClientRect().top - viewport.top };
	});

	await streaming;
	await expect(chat).toContainText(replay.finalTail);
	await expect(chat).toHaveAttribute("data-streaming", "false");
	await expect(chat).toHaveAttribute("data-follow-state", "detached");
	const settledTop = await chat.evaluate((root, rowId) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find(
			(candidate) => candidate.getAttribute("data-chat-row-id") === rowId,
		);
		if (!scroller || !row) throw new Error(`chat row ${rowId} left the rendered transcript`);
		return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	}, anchor.id);
	expect(Math.abs(settledTop - anchor.top)).toBeLessThanOrEqual(PIN_TOLERANCE_PX);
});
