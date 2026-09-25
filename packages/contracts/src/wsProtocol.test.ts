import { describe, expect, test } from "bun:test";
import type { ReviewFixDetails } from "./domain";
import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	customMessageText,
	isTodoReviewFixMessage,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	normalizeSessionTitle,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
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

test("normalized session state advances the protocol and names one snapshot/push channel", () => {
	expect(SESSION_STATE_PROTOCOL_VERSION).toBe(69);
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
