import { expect, test } from "bun:test";
import {
	ACTIVITY_PROTOCOL_VERSION,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	THEME_SYSTEM_PROTOCOL_VERSION,
	WS_CHANNELS,
	WS_METHODS,
} from "./wsProtocol";

test("workspace activity advances the protocol and names its channel and snapshot read", () => {
	expect(ACTIVITY_PROTOCOL_VERSION).toBe(60);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(ACTIVITY_PROTOCOL_VERSION);
	expect(WS_CHANNELS.sessionActivity).toBe("session.activity");
	expect(WS_METHODS.sessionActivityList).toBe("session.activityList");
});

test("system theme settings advance the protocol", () => {
	expect(THEME_SYSTEM_PROTOCOL_VERSION).toBe(58);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(THEME_SYSTEM_PROTOCOL_VERSION);
});

test("subagent settings advance the protocol and name the workspace override mutation", () => {
	expect(SUBAGENT_SETTINGS_PROTOCOL_VERSION).toBe(57);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(SUBAGENT_SETTINGS_PROTOCOL_VERSION);
	expect(WS_METHODS.workspaceSetSubagentsOverride).toBe("workspace.setSubagentsOverride");
});

test("JetBrains quota advances the protocol and names its read", () => {
	expect(JBCENTRAL_QUOTA_PROTOCOL_VERSION).toBe(59);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(JBCENTRAL_QUOTA_PROTOCOL_VERSION);
	expect(WS_METHODS.providerJbcentralQuota).toBe("provider.jbcentralQuota");
});
