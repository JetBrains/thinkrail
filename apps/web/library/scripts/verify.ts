import { chromium, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:24391/";
const failures: string[] = [];
const check = (ok: boolean, message: string) => {
	console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
	if (!ok) failures.push(message);
};

async function open(page: Page, route: string) {
	await page.goto(`${BASE}#/${route}`);
	await page.locator("#library-main h1").first().waitFor();
}

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
	if (message.type() === "error") errors.push(message.text());
});

await open(page, "using");
check(
	(await page.locator("h1").innerText()) === "Using the library",
	"Using the library page renders",
);
await page.getByRole("link", { name: "Button", exact: true }).first().click();
await page.locator("h1", { hasText: "Button" }).waitFor();
check(true, "navigation reaches the Button page");
await page.getByRole("link", { name: "IconButton", exact: true }).first().click();
await page.locator("h1", { hasText: "IconButton" }).waitFor();
check(true, "navigation reaches the IconButton page");

await open(page, "button");
const themeIds: string[] = [];
await page.getByTestId("library-theme").click();
for (const item of await page.locator("[data-theme-id]").all())
	themeIds.push((await item.getAttribute("data-theme-id")) ?? "");
await page.keyboard.press("Escape");
check(themeIds.length >= 6, `theme menu lists every bundled theme (${themeIds.join(", ")})`);
const backgrounds = new Set<string>();
for (const id of themeIds) {
	await page.getByTestId("library-theme").click();
	await page.locator(`[data-theme-id="${id}"]`).click();
	const applied = await page.evaluate(() => document.documentElement.dataset.theme);
	const bg = await page.evaluate(
		() => getComputedStyle(document.querySelector("#root > div") as Element).backgroundColor,
	);
	backgrounds.add(bg);
	check(applied === id, `theme ${id} applies through the theme engine`);
}
check(backgrounds.size >= 4, `themes change the surface colour (${backgrounds.size} distinct)`);

await page.getByTestId("library-theme").click();
await page.locator('[data-theme-id="dark"]').click();
const primary = page.locator('[data-slot="button"][data-variant="primary"][data-size="m"]').first();
await page.locator("#library-main").click({ position: { x: 5, y: 5 } });
await primary.focus();
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Tab");
const focus = await page.evaluate(() => {
	const el = document.activeElement as HTMLElement;
	const style = getComputedStyle(el);
	return {
		visible: el.matches(":focus-visible"),
		outline: `${style.outlineStyle} ${style.outlineWidth}`,
	};
});
check(
	focus.visible && focus.outline === "solid 2px",
	`keyboard focus shows the ring (${focus.outline})`,
);

await open(page, "icon-button");
const basic = page.getByTestId("example-icon-button-basic");
await basic.getByRole("button", { name: "Copy", exact: true }).hover();
const tooltip = page.getByRole("tooltip");
await tooltip.first().waitFor({ timeout: 3000 });
check(
	(await tooltip.first().innerText()).includes("Copy"),
	"IconButton label shows as its tooltip on hover",
);
await page.mouse.move(0, 0);

const disabled = page
	.getByTestId("example-icon-button-disabled-reason")
	.getByTestId("example-preview");
const disabledButton = disabled.locator('[data-slot="button"]');
check(await disabledButton.isDisabled(), "disabled IconButton is natively disabled");
await disabledButton.scrollIntoViewIfNeeded();
const disabledBox = await disabledButton.boundingBox();
if (disabledBox)
	await page.mouse.move(
		disabledBox.x + disabledBox.width / 2,
		disabledBox.y + disabledBox.height / 2,
		{ steps: 5 },
	);
await page.getByRole("tooltip").first().waitFor({ timeout: 3000 });
check(
	(await page.getByRole("tooltip").first().innerText()).includes("one review at a time"),
	"disabled IconButton still shows its reason tooltip",
);
await page.mouse.move(0, 0);

const menu = page.getByTestId("example-icon-button-menu-trigger").getByTestId("example-preview");
await menu.locator('[data-slot="button"]').click();
await page.getByRole("menu").waitFor();
check(
	(await menu.locator('[data-slot="button"]').getAttribute("data-selected")) === "true",
	"open menu trigger shows the selected state",
);
await page.keyboard.press("Escape");

const toggle = page
	.getByTestId("example-icon-button-toggle")
	.getByTestId("example-preview")
	.locator('[data-slot="button"]');
await toggle.click();
check((await toggle.getAttribute("aria-pressed")) === "true", "toggle sets aria-pressed");

await open(page, "button");
const loading = page.getByTestId("example-button-loading").getByTestId("example-preview");
const save = loading.locator('[data-slot="button"]').first();
const widthBefore = (await save.boundingBox())?.width ?? 0;
await save.click();
check((await save.getAttribute("aria-busy")) === "true", "loading sets aria-busy");
check(await save.isDisabled(), "loading natively disables the button");
await save.click({ force: true });
check(
	(await loading.locator("output").innerText()) === "1",
	"a second click while loading is ignored",
);
check(
	Math.abs(((await save.boundingBox())?.width ?? 0) - widthBefore) < 0.5,
	"loading keeps the width",
);

const example = page.getByTestId("example-button-dialog-actions");
await example.getByTestId("library-copy").click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
check(
	copied.includes('from "@thinkrail/ui/button"'),
	"copy puts the example source on the clipboard",
);

await page.setViewportSize({ width: 390, height: 844 });
await open(page, "button");
check(!(await page.locator("aside").first().isVisible()), "narrow layout hides the sidebar");
await page.getByRole("button", { name: "Open navigation" }).click();
await page.locator("#library-nav-drawer").waitFor();
await page.locator("#library-nav-drawer").getByRole("link", { name: "IconButton" }).click();
await page.locator("h1", { hasText: "IconButton" }).waitFor();
check(
	!(await page.locator("#library-nav-drawer").isVisible()),
	"narrow drawer navigates and closes",
);
const overflow = await page.evaluate(() => {
	const main = document.getElementById("library-main") as HTMLElement;
	return Math.max(
		document.documentElement.scrollWidth - window.innerWidth,
		main.scrollWidth - main.clientWidth,
	);
});
check(overflow <= 0, `narrow layout does not scroll the page sideways (${overflow}px)`);

check(errors.length === 0, `no runtime errors (${errors.join(" | ")})`);
await browser.close();
if (failures.length) {
	console.log(`\n${failures.length} failed`);
	process.exit(1);
}
console.log("\nall checks passed");
