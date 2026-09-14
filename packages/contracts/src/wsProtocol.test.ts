import { expect, test } from "bun:test";
import {
	ACTIVITY_PROTOCOL_VERSION,
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	CHAT_RESOURCES_PROTOCOL_VERSION,
	isBackgroundCommandCompletionMessage,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	normalizeSessionTitle,
	PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	SESSION_RENAME_PROTOCOL_VERSION,
	SESSION_TITLE_MAX_LENGTH,
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
	expect(SESSION_RENAME_PROTOCOL_VERSION).toBe(66);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(SESSION_RENAME_PROTOCOL_VERSION);
	expect(SESSION_TITLE_MAX_LENGTH).toBe(80);
	expect(WS_METHODS.sessionRename).toBe("session.rename");
});

test("session titles normalize to one bounded non-blank line", () => {
	expect(normalizeSessionTitle("  Fix auth\r\nredirect  ")).toBe("Fix auth redirect");
	expect(normalizeSessionTitle(" \n ")).toBeNull();
	expect(normalizeSessionTitle(null)).toBeNull();
	expect(normalizeSessionTitle(42)).toBeNull();
	expect(normalizeSessionTitle("x".repeat(80))).toBe("x".repeat(80));
	expect(normalizeSessionTitle("x".repeat(81))).toBeNull();
});

test("command completion guards accept displayed terminal notices, not malformed or hidden details", () => {
	const details = {
		id: "command",
		sessionId: "parent",
		name: "build",
		status: "completed",
		startedAt: 1,
		finishedAt: 2,
		exitCode: 0,
		output: { text: "<script>plain output</script>", truncated: false },
	};
	const message = {
		role: "custom",
		customType: "background-command-completion",
		display: true,
		content: "Finished",
		details,
	};
	expect(isBackgroundCommandCompletionMessage(message)).toBe(true);
	for (const status of ["stopped", "error"]) {
		expect(
			isBackgroundCommandCompletionMessage({
				...message,
				details: { ...details, status, exitCode: null, errorMessage: "diagnostic" },
			}),
		).toBe(true);
	}
	for (const invalid of [
		{ ...message, display: false },
		{ ...message, customType: "unrelated" },
		{ ...message, details: { ...details, status: "running" } },
		{ ...message, details: { ...details, finishedAt: undefined } },
		{ ...message, details: { ...details, startedAt: Number.NaN } },
		{ ...message, details: { ...details, name: {} } },
		{ ...message, details: { ...details, exitCode: "0" } },
		{ ...message, details: { ...details, errorMessage: [] } },
		{ ...message, details: { ...details, output: { text: "log", truncated: "false" } } },
		{ ...message, details: { ...details, output: { text: [] } } },
		null,
	])
		expect(isBackgroundCommandCompletionMessage(invalid)).toBe(false);
});

test("chat resources introduce scoped reads and cancellation, never browser command execution", () => {
	expect(CHAT_RESOURCES_PROTOCOL_VERSION).toBe(67);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(CHAT_RESOURCES_PROTOCOL_VERSION);
	expect(WS_CHANNELS.sessionResourcesChanged).toBe("session.resourcesChanged");
	expect(WS_METHODS.sessionResources).toBe("session.resources");
	expect(WS_METHODS.backgroundCommandOutput).toBe("backgroundCommand.output");
	expect(WS_METHODS.backgroundCommandStop).toBe("backgroundCommand.stop");
	expect(WS_METHODS.subagentStop).toBe("subagent.stop");
	expect(WS_METHODS.subagentStopAll).toBe("subagent.stopAll");
	expect(Object.values(WS_METHODS)).not.toContain("backgroundCommand.start");
});
