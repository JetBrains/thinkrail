import { expect, test } from "bun:test";
import { assertInstallerSmokeEnvironment } from "./installerEnvironment";

test.each<NodeJS.Platform>([
	"darwin",
	"linux",
])("permits the isolated installer probe on %s", (platform) => {
	expect(() => assertInstallerSmokeEnvironment(platform, {})).not.toThrow();
});

test("permits Windows installers only on disposable GitHub-hosted runners", () => {
	expect(() =>
		assertInstallerSmokeEnvironment("win32", {
			GITHUB_ACTIONS: "true",
			RUNNER_ENVIRONMENT: "github-hosted",
		}),
	).not.toThrow();
});

test.each([
	{},
	{ CI: "true" },
	{ GITHUB_ACTIONS: "true" },
	{ RUNNER_ENVIRONMENT: "github-hosted" },
	{ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" },
	{ HOME: "/temporary/home", USERPROFILE: "/temporary/home", APPDATA: "/temporary/appdata" },
])("refuses Windows installation in an environment that could affect a real user: %j", (env) => {
	expect(() => assertInstallerSmokeEnvironment("win32", env)).toThrow(
		"requires a disposable GitHub-hosted Actions runner",
	);
});
