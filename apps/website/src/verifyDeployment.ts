const apexOrigin = "https://thinkrail.ai";
const legacyOrigin = "https://vibecoding.thinkrail.ai";
const directPaths = ["/", "/blog/", "/vibecoding/", "/robots.txt", "/sitemap-index.xml"];

async function requireDirectResponse(path: string): Promise<void> {
	const url = new URL(path, apexOrigin);
	const response = await fetch(url, { redirect: "manual" });
	if (response.status !== 200 || response.headers.has("location")) {
		throw new Error(`${url.href}: expected direct 200, received ${response.status}`);
	}
}

async function requireLegacyRedirect(path: string, expectedPath: string): Promise<void> {
	const url = new URL(path, legacyOrigin);
	const response = await fetch(url, { redirect: "manual" });
	const expected = new URL(expectedPath, apexOrigin).href;
	const actual = response.headers.get("location");
	if (response.status !== 301 || actual !== expected) {
		throw new Error(
			`${url.href}: expected 301 to ${expected}, received ${response.status} to ${actual}`,
		);
	}
}

export async function verifyDeployment(): Promise<void> {
	await Promise.all(directPaths.map(requireDirectResponse));
	await requireLegacyRedirect("/", "/vibecoding/");
	await requireLegacyRedirect(
		"/migration/probe?source=one&source=two&encoded=a%2Fb",
		"/vibecoding/migration/probe?source=one&source=two&encoded=a%2Fb",
	);
}

if (import.meta.main) await verifyDeployment();
