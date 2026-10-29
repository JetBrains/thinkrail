import { expect, test } from "bun:test";
import type { PiLooseExtension, PiPackageSummary, PiPackagesCatalog } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import {
	LooseRow,
	PackageRow,
	PiBuiltinsGroup,
	PiPackagesGroup,
	packageChips,
	piPackageKey,
} from "./PiPackagesSettings";

const JIRA: PiPackageSummary = {
	identity: "npm:@acme/pi-jira",
	source: "npm:@acme/pi-jira",
	kind: "npm",
	scope: "user",
	name: "@acme/pi-jira",
	version: "1.4.2",
	description: "Jira issues and search for the agent",
	installedPath: "/home/me/.pi/agent/npm/node_modules/@acme/pi-jira",
	singleFile: false,
	enabled: true,
	resources: [
		{
			type: "extensions",
			path: "/pkg/extensions/jira.ts",
			displayName: "jira.ts",
			enabled: true,
			tools: ["jira_search", "jira_issue"],
			commands: ["jira"],
		},
		{
			type: "extensions",
			path: "/pkg/extensions/legacy.ts",
			displayName: "legacy.ts",
			enabled: false,
		},
		{ type: "skills", path: "/pkg/skills/triage/SKILL.md", displayName: "triage", enabled: true },
		{ type: "prompts", path: "/pkg/prompts/standup.md", displayName: "standup.md", enabled: true },
	],
};

const GUARD: PiLooseExtension = {
	path: "/home/me/.pi/agent/extensions/guard.ts",
	displayName: "guard.ts",
	scope: "user",
	explicit: false,
	enabled: true,
	error: "SyntaxError: Unexpected token '}'",
};

const CATALOG: PiPackagesCatalog = {
	agentDir: "/home/me/.pi/agent",
	settingsPath: "/home/me/.pi/agent/settings.json",
	projectTrusted: false,
	packages: [JIRA],
	loose: [GUARD],
	builtins: [
		{ name: "mcp", enabled: false, scope: "user" },
		{ name: "tool-search", enabled: true, scope: "user" },
	],
};

const renderToStaticMarkup = (node: ReactNode) =>
	renderMarkup(<TooltipProvider>{node}</TooltipProvider>);

const noop = () => {};
const none = new Set<string>();
const noErrors = new Map<string, string>();

function renderGroup(catalog: PiPackagesGroupCatalog, overrides: Partial<GroupProps> = {}) {
	return renderToStaticMarkup(
		<PiPackagesGroup
			catalog={catalog}
			disabledPackages={[]}
			updates={none}
			checkingUpdates={false}
			busy={none}
			errors={noErrors}
			expanded={none}
			onToggleExpanded={noop}
			onAction={noop}
			onUpdateAll={noop}
			onCheckUpdates={noop}
			{...overrides}
		/>,
	);
}
type GroupProps = Parameters<typeof PiPackagesGroup>[0];
type PiPackagesGroupCatalog = GroupProps["catalog"];

test("packageChips lists tools and slash commands of enabled extensions only", () => {
	expect(packageChips(JIRA.resources)).toEqual(["jira_search", "jira_issue", "/jira"]);
});

test("a package row shows name, kind and scope tags, provenance, chips and an on switch", () => {
	const markup = renderToStaticMarkup(
		<PackageRow
			summary={JIRA}
			updateAvailable={false}
			expanded={false}
			busy={false}
			error={undefined}
			onToggleExpanded={noop}
			onAction={noop}
		/>,
	);
	expect(markup).toContain('data-testid="package-row"');
	expect(markup).toContain('data-identity="npm:@acme/pi-jira"');
	expect(markup).toContain("@acme/pi-jira");
	expect(markup).toMatch(/data-testid="package-kind"[^>]*>npm</);
	expect(markup).toMatch(/data-testid="package-scope"[^>]*>Global</);
	expect(markup).toContain("1.4.2 installed");
	expect(markup).toContain('data-testid="package-chip-jira_search"');
	expect(markup).toContain('data-testid="package-chip-/jira"');
	expect(markup).toContain('data-testid="package-toggle" data-active="true"');
	expect(markup).not.toContain("package-update-available");
	expect(markup).not.toContain("package-resources");
});

test("an off package dims and an update shows as a tag; expanding lists resources with their switches", () => {
	const markup = renderToStaticMarkup(
		<PackageRow
			summary={{ ...JIRA, enabled: false }}
			updateAvailable
			expanded
			busy={false}
			error={undefined}
			onToggleExpanded={noop}
			onAction={noop}
		/>,
	);
	expect(markup).toContain('data-enabled="false"');
	expect(markup).toContain('data-testid="package-update-available"');
	expect(markup).toContain('data-testid="package-resources"');
	expect(markup).toContain('data-testid="package-resource-toggle-legacy.ts" data-active="false"');
	expect(markup).toContain('data-testid="package-resource-toggle-triage" data-active="true"');
	expect(markup).toContain('data-testid="package-resource-toggle-standup.md"');
	expect(markup).toContain('data-testid="package-remove"');
	expect(markup).toContain("Extensions");
	expect(markup).toContain("Skills");
	expect(markup).toContain("Prompts");
});

test("a loose file row carries its path, the local-file tag and its load error with Open folder", () => {
	const markup = renderToStaticMarkup(
		<LooseRow entry={GUARD} busy={false} error={undefined} onAction={noop} />,
	);
	expect(markup).toContain('data-testid="loose-extension-row"');
	expect(markup).toContain("guard.ts");
	expect(markup).toContain("local file");
	expect(markup).toContain('data-testid="package-load-error"');
	expect(markup).toContain("Failed to load: SyntaxError");
	expect(markup).toContain('data-testid="package-load-error-reveal"');
	expect(markup).toContain('data-testid="loose-extension-toggle" data-active="true"');
});

test("the group follows the synced disabled list and the update-check result", () => {
	const markup = renderGroup(CATALOG, {
		disabledPackages: ["npm:@acme/pi-jira"],
		updates: new Set([piPackageKey(JIRA)]),
	});
	expect(markup).toContain('data-testid="package-toggle" data-active="false"');
	expect(markup).toContain('data-testid="package-update-available"');
	expect(markup).toContain('data-testid="packages-update-all"');
	expect(markup).toContain('data-testid="packages-check-updates"');
	expect(markup).toContain('data-testid="loose-extension-row"');
});

test("empty, loading, failed and untrusted states", () => {
	const empty = renderGroup({ ...CATALOG, packages: [], loose: [] });
	expect(empty).toContain('data-testid="packages-empty"');
	expect(empty).toContain('data-testid="packages-gallery-link"');
	expect(empty).not.toContain("packages-empty-install");
	expect(renderGroup("loading")).not.toContain("package-row");
	expect(renderGroup("failed")).toContain('data-testid="packages-failed"');
	const untrusted = renderGroup({
		...CATALOG,
		projectSettingsPath: "/repo/.pi/settings.json",
		projectTrusted: false,
	});
	expect(untrusted).toContain('data-testid="packages-project-untrusted"');
});

test("built-ins render with their copy and switches; a row error shows inline", () => {
	const markup = renderToStaticMarkup(
		<PiBuiltinsGroup
			builtins={CATALOG.builtins}
			settingsPath={CATALOG.settingsPath}
			busy={none}
			errors={new Map([["builtin:mcp", "Couldn't change the package"]])}
			onToggle={noop}
		/>,
	);
	expect(markup).toContain("MCP client");
	expect(markup).toContain("Tool search");
	expect(markup).toContain('data-testid="builtin-toggle-mcp" data-active="false"');
	expect(markup).toContain('data-testid="builtin-toggle-tool-search" data-active="true"');
	expect(markup).toContain('data-testid="package-action-error"');
	expect(markup).toContain(CATALOG.settingsPath);
});

test("a built-in switch reports the deciding scope so a repository override is written where it lives", () => {
	const seen: [string, string, boolean][] = [];
	renderToStaticMarkup(
		<PiBuiltinsGroup
			builtins={[{ name: "mcp", enabled: false, scope: "project" }]}
			settingsPath="/home/me/.pi/agent/settings.json"
			projectSettingsPath="/repo/.pi/settings.json"
			busy={none}
			errors={noErrors}
			onToggle={(builtin, enabled) => seen.push([builtin.name, builtin.scope, enabled])}
		/>,
	);
	const markup = renderToStaticMarkup(
		<PiBuiltinsGroup
			builtins={[{ name: "mcp", enabled: false, scope: "project" }]}
			settingsPath="/home/me/.pi/agent/settings.json"
			projectSettingsPath="/repo/.pi/settings.json"
			busy={none}
			errors={noErrors}
			onToggle={noop}
		/>,
	);
	expect(markup).toContain("/repo/.pi/settings.json");
	expect(seen).toEqual([]);
});

test("a shadowed declaration says so and a single-file package shows its resources without switches", () => {
	const shadowed = renderToStaticMarkup(
		<PackageRow
			summary={{ ...JIRA, shadowed: true }}
			updateAvailable={false}
			expanded={false}
			busy={false}
			error={undefined}
			onToggleExpanded={noop}
			onAction={noop}
		/>,
	);
	expect(shadowed).toContain('data-testid="package-shadowed"');
	const single = renderToStaticMarkup(
		<PackageRow
			summary={{
				...JIRA,
				singleFile: true,
				resources: [JIRA.resources[0] as PiPackageSummary["resources"][number]],
			}}
			updateAvailable={false}
			expanded
			busy={false}
			error={undefined}
			onToggleExpanded={noop}
			onAction={noop}
		/>,
	);
	expect(single).toContain('data-testid="package-resource-jira.ts"');
	expect(single).not.toContain("package-resource-toggle-jira.ts");
});

test("a failed update check renders under the group header", () => {
	const markup = renderGroup(CATALOG, { checkError: "Couldn't check for updates" });
	expect(markup).toContain('data-testid="packages-check-error"');
});
