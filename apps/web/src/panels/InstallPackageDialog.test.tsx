import { expect, test } from "bun:test";
import type { PiPackageSummary, PiPackagesCatalog } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	describeSource,
	InstallPackageBody,
	type InstallStep,
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
				onToggleInstalled={() => {}}
				installedEnabled={() => true}
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
	expect(markup).toContain('data-testid="install-package-notice"');
	expect(markup).toContain('data-testid="packages-gallery-link"');
	expect(markup).toMatch(/data-testid="install-package-submit"[^>]*disabled/);
	const typed = render("w1", CATALOG, { kind: "form" }, "npm:@acme/pi-jira@1.4.2");
	expect(typed).toContain('data-testid="install-package-echo"');
	expect(typed).toContain("Install @acme/pi-jira");
});

test("without a workspace the repository scope is disabled with a reason; untrusted says so too", () => {
	const noWorkspace = render(null, { ...CATALOG, projectSettingsPath: undefined });
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
	expect(installed).toContain("On in all workspaces");
	expect(installed).toContain("jira_search");
	expect(installed).toContain("/jira");
	expect(installed).toContain("skill: triage");
	expect(installed).toContain("/standup");
	expect(installed).toContain('data-testid="install-package-installed-toggle" data-active="true"');
	expect(installed).toContain('data-testid="install-package-done"');

	const failed = render("w1", CATALOG, {
		kind: "failed",
		name: "pi-gone",
		message: "npm ERR! 404 Not Found",
		timedOut: false,
	});
	expect(failed).toContain("npm ERR! 404 Not Found");
	expect(failed).toContain("Nothing was added to your settings.");
	expect(failed).toContain('data-testid="install-package-retry"');
	const timedOut = render("w1", CATALOG, {
		kind: "failed",
		name: "x",
		message: "slow",
		timedOut: true,
	});
	expect(timedOut).not.toContain("Nothing was added to your settings.");
});

test("each step has its dialog title", () => {
	expect(installStepHeader(t, { kind: "form" }).title).toBe("Install a pi package");
	expect(installStepHeader(t, { kind: "installing", name: "x" }).title).toBe("Installing x…");
	expect(installStepHeader(t, { kind: "installed", summary: SUMMARY }).title).toBe(
		"Installed @acme/pi-jira · 1.4.2",
	);
	expect(
		installStepHeader(t, { kind: "failed", name: "x", message: "m", timedOut: false }),
	).toEqual({
		title: "Couldn't install x",
	});
});
