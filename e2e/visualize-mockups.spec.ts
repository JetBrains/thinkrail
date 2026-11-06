import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { clickTranscriptControl } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import {
	MOCKUP_DIR,
	openAppearance,
	openVisualization,
	pickTheme,
	writeMockups,
} from "./fixtures/visualize";

const scriptedMockup = `<!doctype html><html><head>
<link rel="stylesheet" href="thinkrail-theme.css">
<style>body { margin: 0; } #swatch { height: 40px; background: var(--container-elevated-bg); } #out { height: 20px; overflow: hidden; } #painted { height: 0; overflow: hidden; }</style>
</head><body>
<div id="swatch"></div>
<div id="out">static text</div>
<div id="tall"></div>
<div id="painted"></div>
<script>
	document.getElementById("out").textContent = "script ran " + Math.random().toString(36).slice(2);
	addEventListener("thinkrail:themechange", () => {
		document.getElementById("painted").textContent = getComputedStyle(document.getElementById("swatch")).backgroundColor;
	});
	document.getElementById("tall").style.height = "860px";
</script>
</body></html>`;

async function hostColor(page: Page, token: string): Promise<string> {
	return page.evaluate((name) => {
		const probe = document.createElement("div");
		probe.style.backgroundColor = `var(${name})`;
		document.body.append(probe);
		const color = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return color;
	}, token);
}

const swatchColor = (frame: FrameLocator) =>
	frame.locator("#swatch").evaluate((element) => getComputedStyle(element).backgroundColor);

async function oppositeTheme(page: Page): Promise<{ current: string; opposite: string }> {
	const dialog = await openAppearance(page);
	const options = await dialog.locator('[data-testid^="theme-option-"]').evaluateAll((elements) =>
		elements.map((element) => ({
			id: element.getAttribute("data-theme-id") ?? "",
			appearance: element.getAttribute("data-appearance"),
			active: element.getAttribute("data-active") === "true",
		})),
	);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	const current = options.find((option) => option.active);
	const opposite = options.find((option) => option.appearance !== current?.appearance);
	if (!current || !opposite) throw new Error("No opposite appearance theme");
	return { current: current.id, opposite: opposite.id };
}

test("a mockup's scripts run in the card, which sizes itself to the content", async ({ page }) => {
	const cleanup = writeMockups({ "chart.html": scriptedMockup });
	try {
		const card = await openVisualization(page, "scripted mockup", {
			type: "file",
			path: `${MOCKUP_DIR}/chart.html`,
		});
		const preview = card.getByTestId("resource-preview");
		await expect(preview.getByTestId("html-view")).toHaveAttribute("data-scripted", "true");
		await expect(preview.getByTestId("html-scripted-notice")).toBeVisible();
		const frame = preview.frameLocator("iframe");
		await expect(frame.getByText(/^script ran /)).toBeVisible();
		const iframe = preview.locator("iframe");
		await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");

		const box = preview.getByTestId("html-frame-box");
		await expect(box).toHaveAttribute("data-content-height", "920");
		await expect(preview).toHaveAttribute("data-natural-height", "true");
		await expect(box).toHaveAttribute("data-scale", "1.000");
		await expect.poll(async () => Math.round((await box.boundingBox())?.height ?? 0)).toBe(920);
		const previewHeight = (await preview.boundingBox())?.height ?? 0;
		expect(previewHeight).toBeGreaterThan(920);

		await clickTranscriptControl(preview.getByTestId("html-viewport-desktop"));
		await expect.poll(async () => Number(await box.getAttribute("data-scale"))).toBeLessThan(1);
		const scale = Number(await box.getAttribute("data-scale"));
		await expect
			.poll(async () => Math.round((await box.boundingBox())?.height ?? 0))
			.toBe(Math.round(920 * scale));

		await clickTranscriptControl(preview.getByTestId("tool-visualize-fullscreen"));
		const dialog = page.getByTestId("tool-visualize-fullscreen-dialog");
		await expect(dialog.frameLocator("iframe").getByText(/^script ran /)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		await clickTranscriptControl(preview.getByTestId("tool-visualize-open-tab"));
		const tabView = page.locator('[data-testid="html-view"][data-scripted="true"]').last();
		await expect(tabView.frameLocator("iframe").getByText(/^script ran /)).toBeVisible();
	} finally {
		cleanup();
	}
});

test("a mockup follows a theme switch live without reloading its scripts", async ({ page }) => {
	const cleanup = writeMockups({ "theme.html": scriptedMockup });
	try {
		const card = await openVisualization(page, "themed mockup", {
			type: "file",
			path: `${MOCKUP_DIR}/theme.html`,
		});
		const frame = card.getByTestId("resource-preview").frameLocator("iframe");
		const out = frame.locator("#out");
		await expect(out).toHaveText(/^script ran /);
		const firstRun = await out.textContent();
		const before = await hostColor(page, "--container-elevated-bg");
		await expect.poll(() => swatchColor(frame)).toBe(before);

		const { current, opposite } = await oppositeTheme(page);
		try {
			await pickTheme(page, opposite);
			const after = await hostColor(page, "--container-elevated-bg");
			expect(after).not.toBe(before);
			await expect.poll(() => swatchColor(frame)).toBe(after);
			await expect(frame.locator("#painted")).toHaveText(after);
			await expect(out).toHaveText(firstRun ?? "");
		} finally {
			await pickTheme(page, current);
		}
	} finally {
		cleanup();
	}
});

test("a mockup that navigates its frame away is stopped", async ({ page }) => {
	await page.route("https://navigation.example/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "<p>remote page</p>" }),
	);
	const cleanup = writeMockups({
		"leave.html":
			'<!doctype html><html><body><p>leaving</p><script>setTimeout(() => { location.href = "https://navigation.example/away"; }, 50);</script></body></html>',
	});
	try {
		const card = await openVisualization(page, "navigating mockup", {
			type: "file",
			path: `${MOCKUP_DIR}/leave.html`,
		});
		const preview = card.getByTestId("resource-preview");
		await expect(preview.getByTestId("html-navigation-blocked")).toBeVisible();
		await expect(preview.locator("iframe")).toHaveCount(0);
	} finally {
		cleanup();
	}
});

test("a mockup that navigates away before its own load finishes is stopped", async ({ page }) => {
	await page.route("https://navigation.example/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "<p>remote page</p>" }),
	);
	await page.route("https://slow.example/**", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 5000));
		await route.fulfill({ contentType: "text/javascript", body: "" }).catch(() => {});
	});
	const cleanup = writeMockups({
		"replace.html":
			'<!doctype html><html><head><script>location.replace("https://navigation.example/early");</script><script src="https://slow.example/lib.js"></script></head><body><p>leaving</p></body></html>',
	});
	try {
		const card = await openVisualization(page, "early navigating mockup", {
			type: "file",
			path: `${MOCKUP_DIR}/replace.html`,
		});
		const preview = card.getByTestId("resource-preview");
		await expect(preview.getByTestId("html-navigation-blocked")).toBeVisible();
		await expect(preview.locator("iframe")).toHaveCount(0);
	} finally {
		cleanup();
	}
});

const sizedMockup = (height: number) =>
	`<!doctype html><html><head><style>body { margin: 0; }</style></head><body><div id="block"></div><script>document.getElementById("block").style.height = "${height}px";</script></body></html>`;

test("a before/after mockup comparison sizes both sides to the taller document", async ({
	page,
}) => {
	const cleanup = writeMockups({ "old.html": sizedMockup(300), "new.html": sizedMockup(700) });
	try {
		const card = await openVisualization(page, "mockup comparison", {
			type: "file",
			path: `${MOCKUP_DIR}/new.html`,
			before: `${MOCKUP_DIR}/old.html`,
		});
		const preview = card.getByTestId("resource-preview-diff");
		await expect(preview.getByTestId("html-diff-view")).toHaveAttribute("data-fit", "true");
		await expect(preview).toHaveAttribute("data-natural-height", "true");
		const boxes = preview.getByTestId("html-frame-box");
		await expect(boxes).toHaveCount(2);
		for (const box of await boxes.all()) {
			await expect(box).toHaveAttribute("data-content-height", "700");
			await expect.poll(async () => Math.round((await box.boundingBox())?.height ?? 0)).toBe(700);
		}
		expect((await preview.boundingBox())?.height ?? 0).toBeGreaterThan(700);
	} finally {
		cleanup();
	}
});

test("a mockup tab restored before its chat loads turns scripted when the chat arrives", async ({
	page,
}) => {
	let delayMessages = false;
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		const delayed = new Set<string>();
		browser.onMessage((message) => {
			const frame = JSON.parse(String(message));
			if (delayMessages && frame.method === "session.getMessages") delayed.add(frame.id);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message));
			if (delayed.delete(frame.id)) setTimeout(() => browser.send(message), 3_000);
			else browser.send(message);
		});
	});
	const cleanup = writeMockups({ "restored.html": scriptedMockup });
	try {
		const card = await openVisualization(page, "restored mockup", {
			type: "file",
			path: `${MOCKUP_DIR}/restored.html`,
		});
		await clickTranscriptControl(
			card.getByTestId("resource-preview").getByTestId("tool-visualize-open-tab"),
		);
		const fileTab = page
			.locator('[data-testid="editor-tab"][data-kind="file"]')
			.filter({ hasText: "restored.html" });
		await expect(fileTab).toHaveAttribute("data-active", "true");
		const restored = page.getByTestId("html-view").filter({ visible: true });
		await expect(restored).toHaveAttribute("data-scripted", "true");
		delayMessages = true;
		await page.reload();
		await fileTab.click();
		await expect(restored).toHaveAttribute("data-scripted", "false");
		await expect(restored).toHaveAttribute("data-scripted", "true", { timeout: 10_000 });
		await expect(restored.frameLocator("iframe").getByText(/^script ran /)).toBeVisible();
	} finally {
		cleanup();
	}
});

for (const [name, path] of [
	["outside the mockup directory", "static-page.html"],
	["reached through a mockup-dir dot-dot path", `${MOCKUP_DIR}/../../../static-page.html`],
] as const) {
	test(`a repository HTML file ${name} keeps its scripts stripped`, async ({ page }) => {
		writeFileSync(
			join(E2E_FIXTURE_REPO, "static-page.html"),
			'<!doctype html><html><body><p id="out">static text</p><script>document.getElementById("out").textContent = "script ran";</script></body></html>',
		);
		try {
			const card = await openVisualization(page, `repo html ${name}`, { type: "file", path });
			const preview = card.getByTestId("resource-preview");
			await expect(preview.getByTestId("html-view")).toHaveAttribute("data-scripted", "false");
			await expect(preview.getByTestId("html-disabled-notice")).toBeVisible();
			const iframe = preview.locator("iframe");
			await expect(iframe).toHaveAttribute("sandbox", "");
			expect(await iframe.getAttribute("srcdoc")).not.toContain("<script");
			await expect(preview.frameLocator("iframe").getByText("static text")).toBeVisible();
			await expect(preview).not.toHaveAttribute("data-natural-height", "true");
		} finally {
			rmSync(join(E2E_FIXTURE_REPO, "static-page.html"), { force: true });
		}
	});
}
