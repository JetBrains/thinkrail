import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourcePreferencesProvider } from "../host";
import { DiffWrapToggle } from "./DiffWrapToggle";

test.each([false, true])(
	"the wrapping toggle exposes its %s state and remains a tab stop",
	(wrap) => {
		const html = renderToStaticMarkup(
			<TooltipProvider>
				<ResourcePreferencesProvider
					value={{
						fileLineWidth: 120,
						fileLineWidthBounded: false,
						diffWrapLines: wrap,
						setDiffWrapLines: () => {},
						markdownOutlineVisible: null,
						setMarkdownOutlineVisible: () => {},
						markdownOutlineSide: "right",
					}}
				>
					<DiffWrapToggle />
				</ResourcePreferencesProvider>
			</TooltipProvider>,
		);
		expect(html).toContain('aria-label="Wrap lines"');
		expect(html).toContain(`aria-pressed="${wrap}"`);
		expect(html).toContain('tabindex="0"');
		expect(html).toContain('data-testid="diff-toggle-wrap"');
	},
);
