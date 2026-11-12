export default async function piWebAccess(pi) {
	const { default: factory } = await import("pi-web-access/dist/index.js");
	await factory(pi);
}
