import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { shownState, VisibleModelsTree } from "./VisibleModelsSettings";

function model(provider: string, id: string, reasoning = false): WireModel {
	return {
		provider,
		id,
		name: id.toUpperCase(),
		contextWindow: 400_000,
		reasoning,
		thinkingLevels: reasoning ? ["low", "medium", "high"] : [],
	};
}

const MODELS = [
	model("openai", "gpt-a", true),
	model("openai", "gpt-b"),
	model("anthropic", "claude-a"),
	model("google", "gemini-a"),
];

function render(hidden: Pick<WireModel, "provider" | "id">[], expanded: string[] = []) {
	return renderToStaticMarkup(
		<VisibleModelsTree
			models={MODELS}
			hiddenModels={hidden}
			defaultExpanded={expanded}
			setVisible={() => {}}
		/>,
	);
}

function toggle(html: string, provider: string): string {
	return (
		html.match(
			new RegExp(
				`<button[^>]*data-testid="visible-models-provider-toggle"[^>]*data-provider="${provider}"[^>]*>`,
			),
		)?.[0] ?? ""
	);
}

test("a provider is all, some or none shown", () => {
	expect(shownState(2, 2)).toBe("all");
	expect(shownState(1, 2)).toBe("some");
	expect(shownState(0, 2)).toBe("none");
});

test("each provider row's switch is tri-state and counts the models it shows", () => {
	const html = render([
		{ provider: "openai", id: "gpt-b" },
		{ provider: "google", id: "gemini-a" },
	]);
	expect(html).toContain('role="tree"');
	expect(html).toContain('data-setting-row="visible-models"');
	expect(toggle(html, "openai")).toContain('aria-pressed="mixed"');
	expect(toggle(html, "openai")).toContain('data-state="some"');
	expect(toggle(html, "anthropic")).toContain('aria-pressed="true"');
	expect(toggle(html, "google")).toContain('aria-pressed="false"');
	expect(toggle(html, "openai")).toContain("data-setting-side");
	expect(toggle(html, "openai")).toMatch(/tabindex="-?\d"/);
	expect(html).toContain("1 of 2 shown");
	expect(html).toContain("0 of 1 shown");
	expect(html).toContain("2 models hidden.");
	expect(html).not.toContain('data-testid="visible-models-model"');
	expect(html).not.toContain("overflow-y-auto");
});

test("an expanded provider lists its models indented, each with its own switch", () => {
	const html = render([{ provider: "openai", id: "gpt-b" }], ["openai"]);
	const provider = html.match(/<div[^>]*data-testid="visible-models-provider"[^>]*>/)?.[0] ?? "";
	expect(provider).toContain('aria-expanded="true"');
	expect(provider).toContain('aria-level="1"');
	const rows = html.match(/<div[^>]*data-testid="visible-models-model"[^>]*>/g) ?? [];
	expect(rows).toHaveLength(2);
	expect(rows.every((row) => row.includes('aria-level="2"'))).toBe(true);
	expect(html).toContain("400K · reasoning");
	const hidden = html.match(/<button[^>]*data-testid="model-visibility-openai-gpt-b"[^>]*>/)?.[0];
	expect(hidden).toContain('aria-checked="false"');
	expect(hidden).toContain("data-setting-side");
	expect(hidden).toMatch(/tabindex="-?\d"/);
	expect(html).toMatch(/data-testid="model-visibility-openai-gpt-a"[^>]*>/);
});

test("with nothing hidden the description says new models show automatically", () => {
	const html = render([]);
	expect(html).toContain("New models are shown automatically.");
	expect(html).not.toContain("hidden.");
});
