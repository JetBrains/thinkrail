export default async function piWebAccess(pi) {
	const factory = process.versions.bun
		? (await import("pi-web-access/index.ts")).default
		: await importUnderNode();
	await factory(pi);
}

async function importUnderNode() {
	const jiti = "jiti";
	const { createJiti } = await import(jiti);
	return createJiti(import.meta.url).import("pi-web-access/index.ts", { default: true });
}
