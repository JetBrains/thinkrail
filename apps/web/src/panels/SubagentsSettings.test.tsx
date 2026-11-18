import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentsSettings } from "./SubagentsSettings";

test("the Subagents section renders nothing against a host without the subagent protocol", () => {
	expect(renderToStaticMarkup(<SubagentsSettings />)).toBe("");
});
