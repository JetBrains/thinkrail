import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

test("settled loose list text stays on the marker's first line", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openFixtureProject(page);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Loose list alignment",
		messages: [
			{ role: "user", text: "Show the steps and checks.", timestamp: 1_700_700_000_000 },
			{
				role: "assistant",
				text: "1. Tight control one.\n2. Tight control two.\n\n---\n\n1. First numbered step.\n\n   Its explanation stays in the same item.\n\n2. Second numbered step.\n\n   Another explanation.\n\n- First bullet check.\n\n  Its explanation stays in the same item.\n\n- Second bullet check.\n\n  Another explanation.",
				timestamp: 1_700_700_001_000,
			},
		],
	});
	try {
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "Loose list alignment");
		await expect(
			page.locator(`[data-testid="editor-tab"][data-kind="chat"][data-session-id="${session.id}"]`),
		).toBeVisible();
		const answer = page.locator('[data-testid="chat-message"][data-role="assistant"]').filter({
			hasText: "First numbered step.",
		});
		await expect(answer.getByTestId("chat-copy")).toHaveCount(1);
		await expect(answer.locator("ol > li > p").first()).toHaveText("First numbered step.");
		await expect(answer.locator("ul > li > p").first()).toHaveText("First bullet check.");
		const geometry = await answer.locator("ol > li, ul > li").evaluateAll((items) =>
			items.map((item) => {
				const paragraph = item.querySelector(":scope > p");
				const range = document.createRange();
				range.selectNodeContents(paragraph ?? item);
				return {
					text: (paragraph ?? item).textContent,
					loose: paragraph !== null,
					textTop: range.getClientRects()[0]?.top ?? Number.NaN,
					itemTop: item.getBoundingClientRect().top,
					lineHeight: Number.parseFloat(getComputedStyle(item).lineHeight),
				};
			}),
		);
		writeFileSync(
			testInfo.outputPath("loose-list-geometry.json"),
			JSON.stringify(geometry, null, 2),
		);
		await testInfo.attach("loose-list-geometry", {
			body: JSON.stringify(geometry, null, 2),
			contentType: "application/json",
		});
		expect(geometry).toHaveLength(6);
		const tight = geometry.filter((item) => !item.loose);
		expect(tight).toHaveLength(2);
		for (const item of tight) {
			expect(item.lineHeight).toBeGreaterThan(0);
			expect(item.textTop - item.itemTop, `tight-list-control: ${item.text}`).toBeLessThan(
				item.lineHeight / 2,
			);
		}
		await page.screenshot({ path: testInfo.outputPath("loose-list-alignment.png") });
		for (const item of geometry.filter((item) => item.loose)) {
			expect(item.lineHeight).toBeGreaterThan(0);
			expect(item.textTop - item.itemTop, `loose-list-first-line: ${item.text}`).toBeLessThan(
				item.lineHeight / 2,
			);
		}
	} finally {
		rmSync(session.path, { force: true });
	}
});

for (const width of [1280, 900]) {
	test(`loose lists preserve wrapping, paragraphs, nesting and copy at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
		await openFixtureProject(page);
		const wrapped =
			"A deliberately long first paragraph keeps wrapping within this numbered item. ".repeat(12);
		const markdown = `1. ${wrapped}\n\n   Later paragraph remains separate.\n\n   - Nested child one.\n\n     Nested child continuation.\n\n   - Nested child two.\n\n---\n\n999999999. Long tight marker.\n\n---\n\n999999999. Long loose marker.\n\n           Long loose continuation.`;
		const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: `List boundaries ${width}`,
			messages: [
				{ role: "user", text: "Show list layout boundaries.", timestamp: 1_700_700_000_000 },
				{ role: "assistant", text: markdown, timestamp: 1_700_700_001_000 },
			],
		});
		try {
			await enterDefaultWorkspace(page);
			await openPersistedChat(page, `List boundaries ${width}`);
			await expect(
				page.locator(
					`[data-testid="editor-tab"][data-kind="chat"][data-session-id="${session.id}"]`,
				),
			).toBeVisible();
			const answer = page.locator('[data-testid="chat-message"][data-role="assistant"]').filter({
				hasText: "A deliberately long first paragraph",
			});
			await expect(answer.locator("ol[start='999999999']")).toHaveCount(2);
			await expect(answer.locator("ul > li > p").first()).toHaveText("Nested child one.");
			const geometry = await answer.evaluate((element) => {
				const firstItem = element.querySelector("ol > li");
				const first = firstItem?.querySelector(":scope > p:first-child");
				const later = firstItem?.querySelector(":scope > p:nth-child(2)");
				const nested = firstItem?.querySelector(":scope > ul");
				const nestedItem = nested?.querySelector("li");
				const nestedFirst = nestedItem?.querySelector(":scope > p");
				if (!firstItem || !first || !later || !nested || !nestedItem || !nestedFirst) {
					throw new Error(
						"The fixture must retain its wrapped paragraph, later paragraph and nested list",
					);
				}
				const textRects = (node: Node) => {
					const range = document.createRange();
					range.selectNodeContents(node);
					return [...range.getClientRects()].map((rect) => ({
						top: rect.top,
						bottom: rect.bottom,
					}));
				};
				return {
					firstLines: textRects(first),
					itemTop: firstItem.getBoundingClientRect().top,
					lineHeight: Number.parseFloat(getComputedStyle(firstItem).lineHeight),
					laterTop: later.getBoundingClientRect().top,
					laterBottom: later.getBoundingClientRect().bottom,
					nestedTop: nested.getBoundingClientRect().top,
					nestedGlyphTop: textRects(nestedFirst)[0]?.top ?? Number.NaN,
					nestedItemTop: nestedItem.getBoundingClientRect().top,
					nestedLineHeight: Number.parseFloat(getComputedStyle(nestedItem).lineHeight),
					longMarkers: [...element.querySelectorAll("ol[start='999999999'] > li")].map((item) => {
						const content = item.querySelector(":scope > p") ?? item;
						return {
							textTop: textRects(content)[0]?.top ?? Number.NaN,
							itemTop: item.getBoundingClientRect().top,
							lineHeight: Number.parseFloat(getComputedStyle(item).lineHeight),
						};
					}),
				};
			});
			writeFileSync(
				testInfo.outputPath("list-boundary-geometry.json"),
				JSON.stringify(geometry, null, 2),
			);
			expect(geometry.firstLines.length).toBeGreaterThan(1);
			expect(geometry.firstLines[0]?.top ?? Number.NaN).toBeLessThan(
				geometry.itemTop + geometry.lineHeight / 2,
			);
			expect(geometry.laterTop).toBeGreaterThan(geometry.firstLines.at(-1)?.bottom ?? Number.NaN);
			expect(geometry.nestedTop).toBeGreaterThanOrEqual(geometry.laterBottom);
			expect(geometry.nestedGlyphTop - geometry.nestedItemTop).toBeLessThan(
				geometry.nestedLineHeight / 2,
			);
			for (const item of geometry.longMarkers) {
				expect(item.lineHeight).toBeGreaterThan(0);
				expect(item.textTop - item.itemTop).toBeLessThan(item.lineHeight / 2);
			}
			await answer.locator("ol > li > p").first().scrollIntoViewIfNeeded();
			await page.screenshot({ path: testInfo.outputPath(`list-wrapping-${width}.png`) });
			await answer.getByTestId("chat-copy").scrollIntoViewIfNeeded();
			await answer.getByTestId("chat-copy").hover();
			await page.screenshot({ path: testInfo.outputPath(`list-boundaries-${width}.png`) });
			await answer.getByTestId("chat-copy").click();
			await expect(async () => {
				expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
			}).toPass();
		} finally {
			rmSync(session.path, { force: true });
		}
	});
}
