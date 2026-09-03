import { expect, test } from "bun:test";
import { PROTOCOL_VERSION, SUBAGENT_SETTINGS_PROTOCOL_VERSION, WS_METHODS } from "./wsProtocol";

test("subagent settings advance the protocol and name the workspace override mutation", () => {
	expect(PROTOCOL_VERSION).toBe(57);
	expect(SUBAGENT_SETTINGS_PROTOCOL_VERSION).toBe(57);
	expect(WS_METHODS.workspaceSetSubagentsOverride).toBe("workspace.setSubagentsOverride");
});
