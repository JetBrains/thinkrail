import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expandFolds, useFold } from "./foldState";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };

beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
});

function headlessRoot() {
	const noop = () => {};
	return createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element);
}

test("expanding folds opens a mounted fold and one that mounts later", async () => {
	const seen: Record<string, boolean> = {};
	function Fold({ id }: { id: string }) {
		const [expanded] = useFold(id);
		seen[id] = expanded;
		return null;
	}
	const root = headlessRoot();
	await act(async () => root.render(<Fold id="fold-test:mounted" />));
	expect(seen["fold-test:mounted"]).toBe(false);

	await act(async () => expandFolds(["fold-test:mounted", "fold-test:later"]));
	expect(seen["fold-test:mounted"]).toBe(true);

	await act(async () =>
		root.render(
			<>
				<Fold id="fold-test:mounted" />
				<Fold id="fold-test:later" />
			</>,
		),
	);
	expect(seen["fold-test:later"]).toBe(true);
	await act(async () => root.unmount());
});
