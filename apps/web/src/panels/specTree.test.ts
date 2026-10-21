import { expect, test } from "bun:test";
import type { SpecGraphNode } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { buildSpecTree, specDisplayTitle, specRoleLabel, specRoleTag } from "./specTree";

function node(id: string, over: Partial<SpecGraphNode> = {}): SpecGraphNode {
	return {
		id,
		type: "module-design",
		title: id,
		path: `${id}/SPEC.md`,
		dependsOn: [],
		references: [],
		implements: [],
		tags: [],
		...over,
	};
}

test("humanizes known and extension-defined spec roles", () => {
	expect(specRoleLabel(currentTranslator(), "goal-and-requirements")).toBe("Goal");
	expect(specRoleLabel(currentTranslator(), "architecture-design")).toBe("Architecture");
	expect(specRoleLabel(currentTranslator(), "module-design")).toBe("Module");
	expect(specRoleLabel(currentTranslator(), "submodule-design")).toBe("Submodule");
	expect(specRoleLabel(currentTranslator(), "task-spec")).toBe("Task");
	expect(specRoleLabel(currentTranslator(), "risk_register")).toBe("Risk Register");
	expect(specRoleLabel(currentTranslator(), "---")).toBe("Spec");
	expect(specRoleTag(currentTranslator(), "architecture-design")).toBe("ARCH");
	expect(specRoleTag(currentTranslator(), "module-design")).toBe("MODULE");
	expect(specRoleTag(currentTranslator(), "risk_register")).toBe("RISK REGISTER");
});

test("renders dashed titles with a compact dot separator", () => {
	expect(specDisplayTitle("ACP client — spawn, negotiate, translate")).toBe(
		"ACP client · spawn, negotiate, translate",
	);
	expect(specDisplayTitle("meta – the ThinkRail extension namespace")).toBe(
		"meta · the ThinkRail extension namespace",
	);
	expect(specDisplayTitle("browser↔host wire")).toBe("browser↔host wire");
	expect(specDisplayTitle("e2e/workflows — harness")).toBe("e2e/workflows · harness");
});

test("nests children under their parent; roots and siblings sort by title", () => {
	const tree = buildSpecTree([
		node("b-child", { parent: "root", title: "B child" }),
		node("z-root", { title: "Z root" }),
		node("root", { title: "A root" }),
		node("a-child", { parent: "root", title: "A child" }),
	]);
	expect(tree.map((t) => t.node.id)).toEqual(["root", "z-root"]);
	expect(tree[0]?.children.map((c) => c.node.id)).toEqual(["a-child", "b-child"]);
	expect(tree[1]?.children).toEqual([]);
});

test("a dangling or absent parent renders as a root", () => {
	const tree = buildSpecTree([node("orphan", { parent: "nope" }), node("plain")]);
	expect(tree.map((t) => t.node.id).sort()).toEqual(["orphan", "plain"]);
});

test("a self-parenting node renders as a root, not an infinite chain", () => {
	const tree = buildSpecTree([node("selfie", { parent: "selfie" })]);
	expect(tree.map((t) => t.node.id)).toEqual(["selfie"]);
	expect(tree[0]?.children).toEqual([]);
});

test("a parent cycle terminates and leaves well-formed roots intact", () => {
	const tree = buildSpecTree([
		node("a", { parent: "b" }),
		node("b", { parent: "a" }),
		node("root"),
	]);
	expect(tree.map((t) => t.node.id)).toEqual(["root"]);
});
