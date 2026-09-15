import { expect, test } from "bun:test";
import * as protocol from "./wsProtocol";
import {
	ACTIVITY_PROTOCOL_VERSION,
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	THEME_SYSTEM_PROTOCOL_VERSION,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
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

test("Windows shell settings advance the protocol", () => {
	expect(WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION).toBe(62);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION);
});

test("project template previews advance the additive wire shape to v63", () => {
	expect(PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION).toBe(63);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION);
});

test("host update advisories advance the protocol with an immutable notice channel", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(64);
	expect(WS_CHANNELS.hostUpdateAvailable).toBe("host.updateAvailable");
});

test("explicit analytics consent is available from protocol v65", () => {
	expect(ANALYTICS_CONSENT_PROTOCOL_VERSION).toBe(65);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(ANALYTICS_CONSENT_PROTOCOL_VERSION);
});

test("session rename is versioned and bounded", () => {
	const sessionRenameVersion = Reflect.get(protocol, "SESSION_RENAME_PROTOCOL_VERSION");
	expect(sessionRenameVersion).toBe(66);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(sessionRenameVersion);
	expect(Reflect.get(protocol, "SESSION_TITLE_MAX_LENGTH")).toBe(80);
	expect(Reflect.get(WS_METHODS, "sessionRename")).toBe("session.rename");
});

test("session titles normalize to one bounded non-blank line", () => {
	const normalize = Reflect.get(protocol, "normalizeSessionTitle") as
		| ((value: string) => string | null)
		| undefined;
	expect(typeof normalize).toBe("function");
	expect(normalize?.("  Fix auth\r\nredirect  ")).toBe("Fix auth redirect");
	expect(normalize?.(" \n ")).toBeNull();
	expect(normalize?.("x".repeat(80))).toBe("x".repeat(80));
	expect(normalize?.("x".repeat(81))).toBeNull();
});
