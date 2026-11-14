import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("ChatView mounts the trigger, dock and inspector and retires resource-only layers", () => {
	const source = readFileSync(`${import.meta.dir}/ChatView.tsx`, "utf8");
	expect(source).toContain("<ResourcesDock");
	expect(source).toContain("<ResourcesInspector");
	expect(source).toContain("if (!resources.knownUnsupported) return;");
	expect(source).toContain("resources.visible && !inspectorOpen ? (");
});
