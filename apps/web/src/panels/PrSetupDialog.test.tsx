import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { DescriptionBox } from "./PrSetupDialog";

const body = "# Ship the compare hand-off\n\n修复到期日漂移并补回归测试。\n";

function render(boxBody: string): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<DescriptionBox body={boxBody} />
		</TooltipProvider>,
	);
}

test("the omitted description stays on screen when the clipboard cannot take it", () => {
	const markup = render(body);
	// `lib/SPEC.md`: a failed copy (insecure context, denied permission) must leave the text selectable.
	// A read-only textarea is that surface — the copy button is a convenience, not the only way out.
	expect(markup).toContain('data-testid="open-pr-omitted-body"');
	expect(markup).toContain("readOnly");
	expect(markup).toContain("修复到期日漂移并补回归测试。");
	expect(markup).toContain('data-testid="open-pr-omitted-body-copy"');
});

test("the copy button starts out unannounced, never claiming a copy that has not happened", () => {
	const markup = render(body);
	// The label flips to "Copied" only from `copyText`'s own answer, so first render must not show it.
	expect(markup).toContain("Copy description");
	expect(markup).not.toContain("Copied");
});
