import { useState } from "react";
import { type HtmlViewport, htmlViewport } from "./viewport";

export function useHtmlViewport(
	viewState: unknown,
	onViewState: ((state: unknown) => void) | undefined,
): readonly [HtmlViewport, (viewport: HtmlViewport) => void] {
	const incoming = htmlViewport(viewState);
	const [state, setState] = useState({ incoming, viewport: incoming });
	let viewport = state.viewport;
	if (state.incoming !== incoming) {
		setState({ incoming, viewport: incoming });
		viewport = incoming;
	}
	const select = (next: HtmlViewport) => {
		setState({ incoming, viewport: next });
		onViewState?.({ viewport: next });
	};
	return [viewport, select];
}
