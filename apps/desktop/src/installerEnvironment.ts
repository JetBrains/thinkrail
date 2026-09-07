export function assertInstallerSmokeEnvironment(
	platform: NodeJS.Platform,
	env: Record<string, string | undefined>,
): void {
	if (
		platform === "win32" &&
		(env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted")
	) {
		throw new Error(
			"Windows installer smoke requires a disposable GitHub-hosted Actions runner: " +
				"Electrobun writes real Windows shortcuts and HKCU uninstall registration outside the isolated HOME.",
		);
	}
}
