import { expect, test } from "@playwright/test";

// The app's faces must ship *inside* the artifact: ThinkRail runs locally (often offline) and is
// distributed as a single-file binary, so a font CDN would mean system-font fallback on an air-gapped
// host, first paint behind a third party, and a request to Google on every load despite the analytics
// opt-out. These two specs pin both halves of that: nothing is fetched, and the real faces are there.
const FONT_CDNS = /fonts\.(googleapis|gstatic)\.com|api\.fontshare\.com|use\.typekit\.net/;

test("loads no fonts from a CDN", async ({ page }) => {
	const external: string[] = [];
	page.on("request", (r) => {
		if (FONT_CDNS.test(r.url())) external.push(r.url());
	});

	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.evaluate(() => document.fonts.ready);

	expect(external).toEqual([]);
});

test("serves the self-hosted variable faces, including the brand weight and real italics", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const fonts = await page.evaluate(async () => {
		await document.fonts.ready;
		return {
			faces: Array.from(document.fonts).map((f) => ({
				family: f.family,
				weight: f.weight,
				style: f.style,
			})),
			bodyFamily: getComputedStyle(document.body).fontFamily,
		};
	});

	// Both families are declared, and as *variable* faces spanning the weights the type scale uses —
	// 800 (`text-brand`, `font-extrabold`) included, so the brand style is a real face and not the
	// browser's synthetic bold.
	for (const family of ["Geist Variable", "JetBrains Mono Variable"]) {
		const faces = fonts.faces.filter((f) => f.family === family);
		expect(faces.length, `${family} is declared`).toBeGreaterThan(0);
		expect(
			faces.some(
				(f) => f.style === "normal" && /^\d+ \d+$/.test(f.weight) && weightCovers(f.weight, 800),
			),
			`${family} covers weight 800 as a variable range`,
		).toBe(true);
		// Markdown `<em>` renders italic; a real italic face keeps it off synthetic oblique.
		expect(
			faces.some((f) => f.style === "italic"),
			`${family} ships an italic face`,
		).toBe(true);
	}

	// The token stack leads with the bundled face, so body copy actually renders in it.
	expect(fonts.bodyFamily).toContain("Geist Variable");
});

/** `font-weight: 100 900` (a variable range) covers `target`. */
function weightCovers(range: string, target: number): boolean {
	const [min, max] = range.split(" ").map(Number);
	return min !== undefined && max !== undefined && min <= target && target <= max;
}
