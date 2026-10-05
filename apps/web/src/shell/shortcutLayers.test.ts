import { expect, test } from "bun:test";
import { hasDismissibleLayer, type LayerDocument } from "./shortcutLayers";

const OVERLAY = '[data-testid="history-overlay"]';

interface FakeNode {
	groupId?: string;
	overlay?: boolean;
	parent?: FakeNode;
	children: FakeNode[];
}

function node(props: Omit<FakeNode, "children">, children: FakeNode[] = []): FakeNode {
	const n: FakeNode = { ...props, children };
	for (const child of children) child.parent = n;
	return n;
}

function descendants(n: FakeNode): FakeNode[] {
	return n.children.flatMap((c) => [c, ...descendants(c)]);
}

function toElement(n: FakeNode): Element {
	const el = {
		getAttribute: (name: string) => (name === "data-group-id" ? (n.groupId ?? null) : null),
		closest: (selector: string) => {
			if (selector !== "[data-group-id]") return null;
			for (let cur: FakeNode | undefined = n; cur; cur = cur.parent) {
				if (cur.groupId !== undefined) return toElement(cur);
			}
			return null;
		},
		querySelector: (selector: string) =>
			selector === OVERLAY ? (descendants(n).find((d) => d.overlay) ?? null) : null,
	};
	return el as unknown as Element;
}

function fakeDoc(root: FakeNode, active: FakeNode | null) {
	const all = descendants(root);
	return {
		activeElement: active ? toElement(active) : null,
		querySelector: (selector: string) =>
			selector === OVERLAY ? (all.find((d) => d.overlay) ?? null) : null,
		querySelectorAll: (selector: string) =>
			selector === "[data-group-id]"
				? all.filter((d) => d.groupId !== undefined).map(toElement)
				: [],
	} as unknown as LayerDocument;
}

test("finds the overlay of the focused group when focus is on a tab in the strip", () => {
	const tab = node({});
	const root = node({}, [
		node({ groupId: "g1" }, [node({ groupId: "g1" }, [tab]), node({}, [node({ overlay: true })])]),
	]);
	expect(hasDismissibleLayer(fakeDoc(root, tab))).toBe(true);
});

test("ignores an overlay in another group", () => {
	const tab = node({});
	const root = node({}, [
		node({ groupId: "g1" }, [node({ groupId: "g1" }, [tab])]),
		node({ groupId: "g2" }, [node({ overlay: true })]),
	]);
	expect(hasDismissibleLayer(fakeDoc(root, tab))).toBe(false);
});

test("checks the whole document when no group has focus", () => {
	const body = node({});
	const root = node({}, [body, node({ groupId: "g2" }, [node({ overlay: true })])]);
	expect(hasDismissibleLayer(fakeDoc(root, body))).toBe(true);
	expect(hasDismissibleLayer(fakeDoc(root, null))).toBe(true);
});
