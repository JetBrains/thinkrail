import { expect, test } from "bun:test";
import type { TemplateInfo } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { splitTemplates, TemplatesPage } from "./TemplatesSettings";

const template = (
	name: string,
	scope: TemplateInfo["scope"],
	description?: string,
): TemplateInfo => ({
	name,
	scope,
	filePath: `/prompts/${name}.md`,
	...(description ? { description } : {}),
});

const ALL = [
	template("release-notes", "project", "Summarize merged pull requests since the last tag"),
	template("review", "global", "Review a file for issues"),
	template("explain", "global"),
];

const noop = () => {};

function render(
	workspaceId: string | undefined,
	templates: readonly TemplateInfo[] | null = ALL,
	failed = false,
) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<TemplatesPage
				workspaceId={workspaceId}
				split={templates ? splitTemplates(templates) : null}
				failed={failed}
				onRetry={noop}
				onNew={noop}
				onEdit={noop}
				onOpenFile={noop}
				onDelete={noop}
			/>
		</TooltipProvider>,
	);
}

function section(markup: string, testId: string): string {
	const start = markup.indexOf(`data-testid="${testId}"`);
	if (start < 0) throw new Error(`missing ${testId}`);
	const end = markup.indexOf("</section>", start);
	return markup.slice(start, end);
}

test("templates split by scope, each scope keeping its order", () => {
	const { project, global } = splitTemplates(ALL);
	expect(project.map((entry) => entry.name)).toEqual(["release-notes"]);
	expect(global.map((entry) => entry.name)).toEqual(["review", "explain"]);
});

test("with a workspace open there are two groups, This project and All projects, each with its own New and list", () => {
	const markup = render("ws");
	const project = section(markup, "templates-project");
	const global = section(markup, "templates-global");
	expect(project).toContain('data-scope="project"');
	expect(project).toContain('data-testid="template-new-project"');
	expect(project).toContain('data-focus-list="templates:project"');
	expect(project).toContain('data-setting-id="project-templates"');
	expect(project).toContain('data-name="release-notes"');
	expect(project).toContain('data-testid="template-open-file"');
	expect(project).not.toContain('data-name="review"');
	expect(global).toContain('data-scope="allProjects"');
	expect(global).toContain('data-testid="template-new-global"');
	expect(global).toContain('data-focus-list="templates:global"');
	expect(global).toContain('data-name="review"');
	expect(global).toContain('data-name="explain"');
	expect(global).not.toContain('data-testid="template-open-file"');
	expect(markup).not.toContain("project-templates-hint");
	expect(markup).toMatch(/data-focus-row-primary=""[^>]*data-testid="template-edit"/);
	expect(markup).toMatch(/data-setting-side=""[^>]*data-testid="template-delete"/);
	expect(markup).not.toContain('data-testid="template-scope');
});

test("without a workspace only All projects shows, then the project-templates line", () => {
	const markup = render(
		undefined,
		ALL.filter((entry) => entry.scope === "global"),
	);
	expect(markup).not.toContain('data-testid="templates-project"');
	expect(markup).not.toContain('data-testid="template-new-project"');
	expect(markup).toContain('data-testid="templates-global"');
	expect(markup).toMatch(
		/data-testid="project-templates-hint"[^>]*>Project templates appear when a workspace is open\.</,
	);
});

test("empty groups keep their New button: the project explains where templates go, global offers starters", () => {
	const markup = render("ws", []);
	expect(markup).toContain('data-testid="project-templates-empty"');
	expect(markup).toContain('data-testid="global-templates-empty"');
	expect(markup).toContain('data-testid="template-starters"');
	expect(markup).toContain('data-testid="template-new-project"');
	expect(markup).toContain('data-testid="template-new-global"');
});

test("a load failure offers Retry, and loading shows a skeleton", () => {
	const failed = render("ws", null, true);
	expect(failed).toContain('data-testid="templates-error"');
	expect(failed).toMatch(/data-testid="templates-retry"[^>]*>Retry</);
	expect(render("ws", null)).toContain('aria-busy="true"');
});
