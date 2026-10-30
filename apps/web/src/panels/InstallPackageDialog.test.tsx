import { expect, test } from "bun:test";
import {
	type PiPackageScope,
	type PiPackageSummary,
	type PiPackagesCatalog,
	parsePiPackageInput,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestError, RequestTimeoutError } from "@/transport";
import {
	describeSource,
	InstallPackageBody,
	type InstallStep,
	installFailureOutcome,
	installStepHeader,
	sourceDisplayName,
} from "./InstallPackageDialog";

const CATALOG: PiPackagesCatalog = {
	agentDir: "/home/me/.config/pi-work/agent",
	settingsPath: "/home/me/.config/pi-work/agent/settings.json",
	projectSettingsPath: "/repo/.pi/settings.json",
	projectTrusted: true,
	packages: [],
	loose: [],
	builtins: [],
};

const SUMMARY: PiPackageSummary = {
	identity: "npm:@acme/pi-jira",
	source: "npm:@acme/pi-jira@1.4.2",
	kind: "npm",
	scope: "user",
	name: "@acme/pi-jira",
	version: "1.4.2",
	installedPath: "/x",
	switchKeys: ["npm:@acme/pi-jira"],
	enabled: true,
	resources: [],
};

test("describeSource echoes npm (pinned or not), git and local sources", () => {
	expect(describeSource(t, "npm:@acme/pi-jira@1.4.2")).toBe("npm · @acme/pi-jira, pinned to 1.4.2");
	expect(describeSource(t, "npm:@acme/pi-jira")).toBe("npm · @acme/pi-jira");
	expect(describeSource(t, "npm:pi-plain@^1")).toBe("npm · pi-plain");
	expect(describeSource(t, "git:github.com/acme/pi-tools@v2")).toBe(
		"git · github.com/acme/pi-tools@v2",
	);
	expect(describeSource(t, "https://github.com/acme/pi-tools.git")).toBe(
		"git · https://github.com/acme/pi-tools",
	);
	expect(describeSource(t, "~/dev/pi/tools")).toBe("local folder or file · ~/dev/pi/tools");
	expect(describeSource(t, "   ")).toBeNull();
});

test("sourceDisplayName names the package a human would", () => {
	expect(sourceDisplayName("npm:@acme/pi-jira@1.4.2")).toBe("@acme/pi-jira");
	expect(sourceDisplayName("git:github.com/acme/pi-tools@v2")).toBe("pi-tools");
	expect(sourceDisplayName("https://github.com/acme/pi-tools.git")).toBe("pi-tools");
	expect(sourceDisplayName("/home/me/dev/my-hooks")).toBe("my-hooks");
});

function render(
	workspaceId: string | null,
	catalog: PiPackagesCatalog | null,
	step: InstallStep = { kind: "form" },
	source = "",
) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<InstallPackageBody
				step={step}
				source={source}
				scope="user"
				catalog={catalog}
				workspaceId={workspaceId}
				onSourceChange={() => {}}
				onScopeChange={() => {}}
				onSubmit={() => {}}
				onCancel={() => {}}
				onBack={() => {}}
				onDone={() => {}}
			/>
		</TooltipProvider>,
	);
}

test("the form offers both scopes with a trusted workspace and shows the settings path", () => {
	const markup = render("w1", CATALOG);
	expect(markup).toContain('data-step="form"');
	expect(markup).toContain('data-testid="install-package-source"');
	expect(markup).toContain('data-testid="install-package-scope-project"');
	expect(markup).toContain(CATALOG.settingsPath);
	expect(markup).not.toContain("install-package-notice");
	expect(markup).toContain('data-testid="install-package-source-help"');
	expect(markup).toContain('aria-label="What can I paste here?"');
	expect(markup).toContain('data-testid="packages-gallery-link"');
	expect(markup).toMatch(/data-testid="install-package-submit"[^>]*disabled/);
	const typed = render("w1", CATALOG, { kind: "form" }, "npm:@acme/pi-jira@1.4.2");
	expect(typed).toContain('data-testid="install-package-echo"');
	expect(typed).toContain("Install @acme/pi-jira");
});

test("without a workspace the repository scope is disabled with a reason; untrusted says so too", () => {
	const { projectSettingsPath: _projectSettingsPath, ...withoutRepository } = CATALOG;
	const noWorkspace = render(null, withoutRepository);
	expect(noWorkspace).toContain("Open a workspace to install for its repository.");
	const untrusted = render("w1", { ...CATALOG, projectTrusted: false });
	expect(untrusted).toContain("Trust this project before installing packages into its repository.");
});

test("installing, installed and failed steps", () => {
	const installing = render("w1", CATALOG, { kind: "installing", name: "@acme/pi-jira" });
	expect(installing).toContain('data-step="installing"');
	expect(installing).toContain('role="progressbar"');
	expect(installing).not.toContain("install-package-submit");

	const installed = render("w1", CATALOG, {
		kind: "installed",
		summary: {
			...SUMMARY,
			resources: [
				{
					type: "extensions",
					path: "/x/e.ts",
					displayName: "e.ts",
					enabled: true,
					tools: ["jira_search"],
					commands: ["jira"],
				},
				{ type: "skills", path: "/x/skills/triage/SKILL.md", displayName: "triage", enabled: true },
				{
					type: "prompts",
					path: "/x/prompts/standup.md",
					displayName: "standup.md",
					enabled: true,
				},
			],
		},
	});
	expect(installed).toContain("Installed globally");
	expect(installed).toContain("jira_search");
	expect(installed).toContain("/jira");
	expect(installed).toContain("skill: triage");
	expect(installed).toContain("/standup");
	expect(installed).not.toContain("install-package-installed-toggle");
	expect(installed).toContain("Installed globally");
	expect(installed).toContain('data-testid="install-package-done"');

	const failed = render("w1", CATALOG, {
		kind: "failed",
		name: "pi-gone",
		message: "npm ERR! 404 Not Found",
		outcome: "nothingAdded",
	});
	expect(failed).toContain("npm ERR! 404 Not Found");
	expect(failed).toContain("Nothing was added to your settings.");
	expect(failed).toContain('data-testid="install-package-retry"');
	const unknown = render("w1", CATALOG, {
		kind: "failed",
		name: "x",
		message: "socket closed",
		outcome: "unknown",
	});
	expect(unknown).not.toContain("Nothing was added to your settings.");
	expect(unknown).toContain("It may have been added anyway — check the list.");
	const timedOut = render("w1", CATALOG, {
		kind: "failed",
		name: "x",
		message: "slow",
		outcome: "timedOut",
	});
	expect(timedOut).not.toContain("Nothing was added to your settings.");
	expect(timedOut).not.toContain("check the list.");
});

test("only a failure the host raised before persisting means nothing was added", () => {
	expect(installFailureOutcome(new RequestError("PACKAGE_INSTALL_FAILED", "npm ERR!"))).toBe(
		"nothingAdded",
	);
	expect(installFailureOutcome(new RequestError("PACKAGE_UNTRUSTED", "trust"))).toBe(
		"nothingAdded",
	);
	expect(installFailureOutcome(new RequestError("PACKAGE_INSTALLED_UNLISTED", "added"))).toBe(
		"unknown",
	);
	expect(installFailureOutcome(new Error("socket closed"))).toBe("unknown");
	expect(installFailureOutcome(new RequestTimeoutError("slow"))).toBe("timedOut");
});

test("each step has its dialog title", () => {
	expect(installStepHeader(t, { kind: "form" }).title).toBe("Install a pi package");
	expect(installStepHeader(t, { kind: "installing", name: "x" }).title).toBe("Installing x…");
	expect(installStepHeader(t, { kind: "installed", summary: SUMMARY }).title).toBe(
		"Installed @acme/pi-jira · 1.4.2",
	);
	expect(
		installStepHeader(t, { kind: "failed", name: "x", message: "m", outcome: "nothingAdded" }),
	).toEqual({
		title: "Couldn't install x",
	});
});

test("the echo and the display name read gallery links, pasted commands and bare names as npm", () => {
	expect(describeSource(t, "https://pi.dev/packages/@jals1212/pi-spaces")).toBe(
		"npm · @jals1212/pi-spaces",
	);
	expect(describeSource(t, "pi install npm:@jals1212/pi-spaces")).toBe("npm · @jals1212/pi-spaces");
	expect(describeSource(t, "https://www.npmjs.com/package/@jals1212/pi-spaces/v/0.4.0")).toBe(
		"npm · @jals1212/pi-spaces, pinned to 0.4.0",
	);
	expect(describeSource(t, "@jals1212/pi-spaces")).toBe("npm · @jals1212/pi-spaces");
	expect(sourceDisplayName("https://pi.dev/packages/@jals1212/pi-spaces")).toBe(
		"@jals1212/pi-spaces",
	);
	expect(describeSource(t, "./tools")).toBe("local folder or file · ./tools");
});

test("a pasted `pi install -l …` line selects the repository scope when it is available", () => {
	let scope: PiPackageScope = "user";
	let source = "";
	const render = () =>
		renderToStaticMarkup(
			<TooltipProvider>
				<InstallPackageBody
					step={{ kind: "form" }}
					source={source}
					scope={scope}
					catalog={{
						...CATALOG,
						projectTrusted: true,
						projectSettingsPath: "/repo/.pi/settings.json",
					}}
					workspaceId="w1"
					onSourceChange={() => {}}
					onScopeChange={() => {}}
					onSubmit={() => {}}
					onCancel={() => {}}
					onBack={() => {}}
					onDone={() => {}}
				/>
			</TooltipProvider>,
		);
	source = "pi install -l npm:@acme/pi-jira";
	if (parsePiPackageInput(source).local) scope = "project";
	expect(render()).toContain('data-testid="install-package-scope-project" data-active="true"');
	expect(render()).toContain("npm · @acme/pi-jira");
});
