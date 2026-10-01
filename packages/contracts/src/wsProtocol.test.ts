import { describe, expect, test } from "bun:test";
import type { ReviewFixDetails } from "./domain";
import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	CHAT_RESOURCES_PROTOCOL_VERSION,
	customMessageText,
	DEFAULT_MODEL_PROTOCOL_VERSION,
	HOST_UPDATE_RUN_PROTOCOL_VERSION,
	isBackgroundCommandCompletionMessage,
	isTodoReviewFixMessage,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	normalizeSessionTitle,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION,
	PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	REVIEW_RICH_ANCHORS_PROTOCOL_VERSION,
	SESSION_RENAME_PROTOCOL_VERSION,
	SESSION_STATE_PROTOCOL_VERSION,
	SESSION_TITLE_MAX_LENGTH,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	THEME_SYSTEM_PROTOCOL_VERSION,
	TODO_REVIEW_FIX_CUSTOM_TYPE,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
	WS_CHANNELS,
	WS_METHODS,
} from "./wsProtocol";

test("retired workspace activity keeps only its empty snapshot compatibility method", () => {
	expect(WS_METHODS.sessionActivityList).toBe("session.activityList");
	expect(Object.hasOwn(WS_CHANNELS, "sessionActivity")).toBe(false);
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

test("host update execution advances the additive lifecycle protocol", () => {
	expect(HOST_UPDATE_RUN_PROTOCOL_VERSION).toBe(70);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(HOST_UPDATE_RUN_PROTOCOL_VERSION);
	expect(WS_CHANNELS.hostUpdateAvailable).toBe("host.updateAvailable");
	expect(WS_METHODS.hostUpdate).toBe("host.update");
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

test("normalized session state advances the protocol and names one snapshot/push channel", () => {
	expect(SESSION_STATE_PROTOCOL_VERSION).toBe(73);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(SESSION_STATE_PROTOCOL_VERSION);
	expect(WS_METHODS.sessionStateList).toBe("session.stateList");
	expect(WS_METHODS.sessionAcknowledgeCompletion).toBe("session.acknowledgeCompletion");
	expect(WS_METHODS.sessionNudge).toBe("session.nudge");
	expect(WS_CHANNELS.sessionState).toBe("session.state");
});

test("session titles normalize to one bounded non-blank line", () => {
	expect(normalizeSessionTitle("  Fix auth\r\nredirect  ")).toBe("Fix auth redirect");
	expect(normalizeSessionTitle(" \n ")).toBeNull();
	expect(normalizeSessionTitle(null)).toBeNull();
	expect(normalizeSessionTitle(42)).toBeNull();
	expect(normalizeSessionTitle("x".repeat(80))).toBe("x".repeat(80));
	expect(normalizeSessionTitle("x".repeat(81))).toBeNull();
});

test("the plan-review subagent reshapes the review wire and advances the protocol", () => {
	expect(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION).toBe(67);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION);
	expect(WS_CHANNELS.reviewChanged).toBe("review.changed");
	expect(WS_CHANNELS.reviewFailed).toBe("review.failed");
});

test("the agent-review setting advances the protocol to v68", () => {
	expect(AGENT_REVIEW_SETTING_PROTOCOL_VERSION).toBe(68);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(AGENT_REVIEW_SETTING_PROTOCOL_VERSION);
});

test("auto plan-summary generation advances the protocol to v69", () => {
	expect(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION).toBe(69);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION);
	expect(WS_METHODS.todoGenerateSummary).toBe("todo.generateSummary");
});

test("host-owned new-chat defaults are pinned to v72", () => {
	expect(DEFAULT_MODEL_PROTOCOL_VERSION).toBe(72);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(DEFAULT_MODEL_PROTOCOL_VERSION);
	expect(WS_METHODS.modelDefault).toBe("model.default");
	expect(WS_METHODS).not.toHaveProperty("modelSetDefault");
});

test("rich review anchors advance the additive selector union to v74", () => {
	expect(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION).toBe(74);
	expect(PROTOCOL_VERSION).toBe(74);
	expect(WS_METHODS.reviewCommentAdd).toBe("review.commentAdd");
});

describe("isTodoReviewFixMessage", () => {
	const details: ReviewFixDetails = {
		itemId: "t_1",
		itemTitle: "Fix login redirect",
		reviewId: "r_1",
		note: "See the two findings below.",
		comments: [{ id: "c_1", kind: "inline", body: "off-by-one", path: "src/a.ts", startLine: 4 }],
	};
	const message = {
		role: "custom",
		customType: TODO_REVIEW_FIX_CUSTOM_TYPE,
		content: "Address each review comment above.",
		display: true,
		details,
		timestamp: 0,
	};

	test("accepts a well-formed todo-review-fix message", () => {
		expect(isTodoReviewFixMessage(message)).toBe(true);
	});

	test("rejects other custom types, roles, and malformed details", () => {
		expect(isTodoReviewFixMessage({ ...message, customType: "subagent-completion" })).toBe(false);
		expect(isTodoReviewFixMessage({ ...message, role: "user" })).toBe(false);
		expect(isTodoReviewFixMessage({ ...message, details: { itemId: "t_1" } })).toBe(false);
		expect(isTodoReviewFixMessage({ ...message, details: undefined })).toBe(false);
		expect(isTodoReviewFixMessage(null)).toBe(false);
		expect(isTodoReviewFixMessage("nope")).toBe(false);
	});

	test("comments may be empty (a note-only fix request)", () => {
		expect(isTodoReviewFixMessage({ ...message, details: { ...details, comments: [] } })).toBe(
			true,
		);
	});
});

describe("customMessageText", () => {
	test("returns a string content verbatim", () => {
		expect(customMessageText("hello")).toBe("hello");
	});

	test("joins text blocks and drops non-text content", () => {
		expect(
			customMessageText([
				{ type: "text", text: "a" },
				{ type: "image", data: "x", mimeType: "image/png" },
				{ type: "text", text: "b" },
			]),
		).toBe("ab");
	});
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
	expect(CHAT_RESOURCES_PROTOCOL_VERSION).toBe(71);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(CHAT_RESOURCES_PROTOCOL_VERSION);
	expect(WS_CHANNELS.sessionResourcesChanged).toBe("session.resourcesChanged");
	expect(WS_METHODS.sessionResources).toBe("session.resources");
	expect(WS_METHODS.backgroundCommandOutput).toBe("backgroundCommand.output");
	expect(WS_METHODS.backgroundCommandStop).toBe("backgroundCommand.stop");
	expect(WS_METHODS.subagentStop).toBe("subagent.stop");
	expect(WS_METHODS.subagentStopAll).toBe("subagent.stopAll");
	expect(Object.values(WS_METHODS)).not.toContain("backgroundCommand.start");
});
