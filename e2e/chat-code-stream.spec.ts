import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { interceptAppWire, playStreamReplay, textStreamReplay } from "./fixtures/streamReplay";

const BASE_TS = 1_700_980_000_000;
const FRAME_GAP_MS = 15;
const TS_SOURCE = Array.from(
	{ length: 80 },
	(_, line) => `export const value${line} = compute(${line}, "row ${line}"); // line ${line}`,
).join("\n");
const ANSI_LINES = Array.from({ length: 40 }, (_, line) => `step ${line} red ok`);
const ANSI_SOURCE = ANSI_LINES.map((line) => line.replace("red", "\x1b[31mred\x1b[0m")).join("\n");
const ANSI_TEXT = ANSI_LINES.join("\n");

interface CodeWindow {
	__codeSamples: { torn: string[]; seen: number };
}

const installSampler = (page: Page, source: string) =>
	page.evaluate((expected) => {
		const samples: CodeWindow["__codeSamples"] = { torn: [], seen: 0 };
		(window as unknown as CodeWindow).__codeSamples = samples;
		const chat = [...document.querySelectorAll<HTMLElement>('[data-testid="chat-scroll"]')].find(
			(element) => element.offsetParent !== null,
		);
		if (!chat) throw new Error("The chat transcript is not mounted");
		const marker = expected.slice(0, 20);
		new MutationObserver(() => {
			for (const pre of chat.querySelectorAll("pre")) {
				const text = pre.textContent ?? "";
				if (!text.startsWith(marker)) continue;
				samples.seen += 1;
				if (!expected.startsWith(text)) samples.torn.push(text.slice(-80));
			}
		}).observe(chat, { subtree: true, childList: true, characterData: true });
	}, source);

test("a streamed code block grows without losing or repeating a line, and ansi keeps its colors", async ({
	page,
}) => {
	const wire = await interceptAppWire(page);
	await openFixtureProject(page);
	const title = "code stream";
	const seeded = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: title,
		messages: [{ role: "user", text: "Show the code", timestamp: BASE_TS }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	const chat = page.getByTestId("chat-scroll").filter({ visible: true });
	await expect(chat).toBeVisible();
	await installSampler(page, TS_SOURCE);

	const text = `Here it is.\n\n\`\`\`ts\n${TS_SOURCE}\n\`\`\`\n\n\`\`\`ansi\n${ANSI_SOURCE}\n\`\`\`\n\nDone.`;
	await playStreamReplay(wire(), textStreamReplay(seeded.id, text, BASE_TS + 1_000), FRAME_GAP_MS);
	await expect(chat).toHaveAttribute("data-streaming", "false");

	const ts = chat.locator("pre.highlights").filter({ hasText: "value0" });
	await expect.poll(() => ts.evaluate((pre) => pre.textContent)).toBe(TS_SOURCE);
	await expect(
		ts.locator('span[style*="var(--code-"]').filter({ hasText: "value79" }),
	).not.toHaveCount(0);
	const samples = await page.evaluate(() => (window as unknown as CodeWindow).__codeSamples);
	expect(samples.seen, "observed the block while it streamed").toBeGreaterThan(10);
	expect(samples.torn, "texts that were not a prefix of the source").toEqual([]);

	const ansi = chat.locator("pre.highlights").filter({ hasText: "step 39" });
	await expect.poll(() => ansi.evaluate((pre) => pre.textContent)).toBe(ANSI_TEXT);
	await expect(ansi.locator('span[style*="color"]').filter({ hasText: /^red$/ })).not.toHaveCount(
		0,
	);
});
