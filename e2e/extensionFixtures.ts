/** Builds the sample extension the installed-extension specs install; turbo caches it after the first run. */
export async function buildExtensionFixtures(playwrightArgs: readonly string[]): Promise<number> {
	if (playwrightArgs.includes("--list")) return 0;
	const build = Bun.spawn([process.execPath, "run", "build:extension-fixtures"], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await build.exited;
}
