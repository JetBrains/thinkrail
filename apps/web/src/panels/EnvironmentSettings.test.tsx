import { expect, test } from "bun:test";
import type { HostEnvironmentStatus } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentForm, type EnvironmentFormProps } from "./EnvironmentSettings";
import {
	draftChanged,
	draftFromEnvironment,
	draftIssues,
	type EnvironmentDraft,
	type EnvironmentDraftIssues,
	environmentFromDraft,
	NO_ISSUES,
	revertDraftField,
} from "./environmentDraft";

const STATUS: HostEnvironmentStatus = {
	stored: {
		agentDir: "~/.pi/agent-personal",
		vars: [
			{ name: "OPENAI_API_KEY", value: "sk-secret" },
			{ name: "HTTPS_PROXY", value: "http://127.0.0.1:8888" },
		],
	},
	restartRequired: false,
	launchOverridden: [],
	effectiveAgentDir: "/Users/alex/.pi/agent-personal",
};

const render = (
	status: Parameters<typeof EnvironmentForm>[0]["status"],
	draft: EnvironmentDraft = typeof status === "object"
		? draftFromEnvironment(status.stored)
		: { agentDir: "", vars: [] },
	issues: EnvironmentDraftIssues = NO_ISSUES,
	saving = false,
) =>
	renderToStaticMarkup(
		<TooltipProvider>
			<EnvironmentForm
				status={status}
				draft={draft}
				issues={issues}
				saving={saving}
				saveFailed={false}
				onChange={() => {}}
				onSave={() => {}}
				onDiscard={() => {}}
			/>
		</TooltipProvider>,
	);

test("renders the stored folder, the folder in use and masked variable values", () => {
	const markup = render(STATUS);
	expect(markup).toContain('value="~/.pi/agent-personal"');
	expect(markup).toContain("/Users/alex/.pi/agent-personal");
	expect(markup).toContain('value="OPENAI_API_KEY"');
	expect(markup).toMatch(/type="password"[^>]*value="sk-secret"/);
	expect(markup).not.toContain('data-testid="settings-environment-restart"');
	expect(markup).toMatch(/data-testid="settings-environment-save"[^>]*disabled/);
});

test("after a save the restart notice stays, and launch overrides explain themselves in visible text", () => {
	const markup = render({
		...STATUS,
		restartRequired: true,
		launchOverridden: ["PI_CODING_AGENT_DIR", "HTTPS_PROXY"],
	});
	expect(markup).toMatch(
		/data-testid="settings-environment-restart"[\s\S]*Saved changes apply after you restart ThinkRail\./,
	);
	expect(markup.indexOf("settings-environment-restart")).toBeLessThan(
		markup.indexOf("settings-environment-agent-dir"),
	);
	expect(markup).toContain('data-testid="settings-environment-agent-dir-overridden"');
	expect(markup.match(/data-testid="settings-environment-var-overridden"/g)).toHaveLength(1);
	expect(markup).toMatch(
		/data-testid="settings-environment-var-overridden-hint"[^>]*>This variable was set when ThinkRail started, so the launch value is used\.</,
	);
	expect(markup).not.toContain("title=");
});

test("fields use the kit's input style and every control is an explicit tab stop", () => {
	const markup = render(STATUS);
	for (const testId of [
		"settings-environment-agent-dir",
		"settings-environment-var-name",
		"settings-environment-var-value",
	]) {
		const input = markup.match(new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
		expect(input).toContain('tabindex="0"');
		expect(input).toContain("border-control-border-default");
		expect(input).not.toContain("data-settings-draft-input");
	}
	expect(markup).toContain('data-setting-id="pi-config-folder"');
	expect(markup).toContain('data-setting-id="environment-variables"');
	expect(markup).toMatch(/data-setting-row="environment-var\/[^"]+"/);
});

test("issues render under their field and row", () => {
	const draft = draftFromEnvironment(STATUS.stored);
	const markup = render(STATUS, draft, {
		agentDir: "notFound",
		vars: { [draft.vars[1]?.id ?? ""]: "reserved" },
	});
	expect(markup).toContain("This folder doesn&#x27;t exist.");
	expect(markup).toContain("ThinkRail manages this variable, so it can&#x27;t be set here.");
});

test("the whole form is locked while a save is in flight, so no edit can be overwritten by its response", () => {
	expect(render(STATUS)).toMatch(
		/<fieldset(?![^>]*disabled)[^>]*data-testid="settings-environment-form"/,
	);
	expect(render(STATUS, undefined, NO_ISSUES, true)).toMatch(
		/<fieldset[^>]*disabled=""[^>]*data-testid="settings-environment-form"/,
	);
});

test("loading renders nothing and failure renders a notice with Retry", () => {
	expect(render("loading")).toBe("");
	expect(render("failed")).toContain('data-testid="settings-environment-failed"');
	const retry = renderToStaticMarkup(
		<EnvironmentForm
			status="failed"
			draft={{ agentDir: "", vars: [] }}
			issues={NO_ISSUES}
			saving={false}
			saveFailed={false}
			onChange={() => {}}
			onSave={() => {}}
			onDiscard={() => {}}
			onRetry={() => {}}
		/>,
	);
	expect(retry).toContain('data-testid="settings-environment-retry"');
});

test("the draft drops blank rows and maps server issue indexes back to rows", () => {
	const draft: EnvironmentDraft = {
		agentDir: "  ",
		vars: [
			{ id: "a", name: "", value: "" },
			{ id: "b", name: " FOO ", value: "1" },
			{ id: "c", name: "PATH", value: "x" },
		],
	};
	expect(environmentFromDraft(draft)).toEqual({
		vars: [
			{ name: "FOO", value: "1" },
			{ name: "PATH", value: "x" },
		],
	});
	expect(draftIssues(draft, [{ field: "var", index: 1, code: "reserved" }])).toEqual({
		vars: { c: "reserved" },
	});
});

test("the draft is unchanged until a field differs from the stored record", () => {
	const draft = draftFromEnvironment(STATUS.stored);
	expect(draftChanged(draft, STATUS)).toBe(false);
	expect(draftChanged({ ...draft, agentDir: "~/.pi/agent" }, STATUS)).toBe(true);
	expect(draftChanged({ ...draft, vars: draft.vars.slice(1) }, STATUS)).toBe(true);
});

test("Esc reverts only the field it is pressed in, back to the loaded value, then lets Esc through", () => {
	const baseline = draftFromEnvironment(STATUS.stored);
	const [first, second] = baseline.vars;
	if (!first || !second) throw new Error("fixture vars");
	const renamed = { ...second, name: "HTTP_PROXY" };
	const fresh = { id: "fresh", name: "NEW_VAR", value: "1" };
	const edited: EnvironmentDraft = {
		agentDir: "/elsewhere",
		vars: [{ ...first, value: "sk-edited" }, renamed, fresh],
	};
	expect(revertDraftField(edited, baseline, { kind: "value", id: first.id })).toEqual({
		...edited,
		vars: [first, renamed, fresh],
	});
	expect(revertDraftField(edited, baseline, { kind: "agentDir" })?.agentDir).toBe(
		"~/.pi/agent-personal",
	);
	expect(revertDraftField(edited, baseline, { kind: "name", id: second.id })?.vars[1]).toEqual(
		second,
	);
	expect(revertDraftField(edited, baseline, { kind: "name", id: "fresh" })?.vars[2]).toEqual({
		id: "fresh",
		name: "",
		value: "1",
	});
	expect(revertDraftField(baseline, baseline, { kind: "agentDir" })).toBeNull();
	expect(revertDraftField(edited, baseline, { kind: "name", id: first.id })).toBeNull();
});

function findInputs(
	node: unknown,
	found: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
	if (Array.isArray(node)) {
		for (const child of node) findInputs(child, found);
		return found;
	}
	if (!isValidElement<Record<string, unknown>>(node)) return found;
	if (node.type === "input") found.push(node.props);
	for (const value of Object.values(node.props)) findInputs(value, found);
	return found;
}

function pressEscape(props: EnvironmentFormProps, testId: string, index = 0) {
	const seen: { draft: EnvironmentDraft | null; prevented: boolean } = {
		draft: null,
		prevented: false,
	};
	const Capture = () => {
		const tree = EnvironmentForm({ ...props, onChange: (draft) => (seen.draft = draft) });
		const input = findInputs(tree).filter((candidate) => candidate["data-testid"] === testId)[
			index
		];
		const onKeyDown = input?.onKeyDown;
		if (typeof onKeyDown === "function") {
			onKeyDown({
				key: "Escape",
				nativeEvent: { isComposing: false, keyCode: 27 },
				preventDefault: () => (seen.prevented = true),
			});
		}
		return null;
	};
	renderToStaticMarkup(<Capture />);
	return { changed: seen.draft, prevented: seen.prevented };
}

test("Esc in an edited field reverts that field and is consumed; in a clean field it goes through", () => {
	const baseline = draftFromEnvironment(STATUS.stored);
	const [first, second] = baseline.vars;
	if (!first || !second) throw new Error("fixture vars");
	const draft: EnvironmentDraft = {
		agentDir: "/elsewhere",
		vars: [{ ...first, value: "sk-edited" }, second],
	};
	const props: EnvironmentFormProps = {
		status: STATUS,
		draft,
		baseline,
		issues: NO_ISSUES,
		saving: false,
		saveFailed: false,
		onChange: () => {},
		onSave: () => {},
		onDiscard: () => {},
	};
	const value = pressEscape(props, "settings-environment-var-value");
	expect(value.prevented).toBe(true);
	expect(value.changed).toEqual({ agentDir: "/elsewhere", vars: [first, second] });
	const clean = pressEscape(props, "settings-environment-var-value", 1);
	expect(clean.prevented).toBe(false);
	expect(clean.changed).toBeNull();
	const folder = pressEscape(props, "settings-environment-agent-dir");
	expect(folder.prevented).toBe(true);
	expect(folder.changed?.agentDir).toBe("~/.pi/agent-personal");
	expect(folder.changed?.vars[0]?.value).toBe("sk-edited");
});
