import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CONFIG,
	isSettleIdleDays,
	isSubagentMaxConcurrent,
	RECENT_MODELS_LIMIT,
	type ReviewFixDetails,
	SETTLE_IDLE_DAYS,
	SUBAGENT_MAX_CONCURRENT,
} from "./domain";
import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	BRANCH_STATUS_PROTOCOL_VERSION,
	CHANGE_MUTATIONS_PROTOCOL_VERSION,
	CHAT_RESOURCES_PROTOCOL_VERSION,
	CLIENT_ERROR_REPORT_PROTOCOL_VERSION,
	CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	completionDelivery,
	customMessageText,
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	HOST_ENVIRONMENT_PROTOCOL_VERSION,
	HOST_UPDATE_RUN_PROTOCOL_VERSION,
	isBackgroundCommandCompletionMessage,
	isTodoReviewFixMessage,
	isToolResponsePending,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	LOCALES_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	MCP_TOOL_GRANTS_PROTOCOL_VERSION,
	MODEL_PICKER_PROTOCOL_VERSION,
	normalizeSessionTitle,
	ONBOARDING_PROTOCOL_VERSION,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION,
	PROJECT_RENAME_PROTOCOL_VERSION,
	PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION,
	PROJECT_TRUST_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	RESOURCE_META_PROTOCOL_VERSION,
	REVIEW_ACTIONS_PROTOCOL_VERSION,
	REVIEW_RICH_ANCHORS_PROTOCOL_VERSION,
	readToolResponseMessage,
	SESSION_RENAME_PROTOCOL_VERSION,
	SESSION_STATE_PROTOCOL_VERSION,
	SESSION_TITLE_MAX_LENGTH,
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	THEME_SYSTEM_PROTOCOL_VERSION,
	TODO_REVIEW_FIX_CUSTOM_TYPE,
	TOOL_RESPONSE_CUSTOM_TYPE,
	TOOL_RESPONSE_PROTOCOL_VERSION,
	TURN_CHANGES_PROTOCOL_VERSION,
	USER_THEMES_PROTOCOL_VERSION,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
	WORKSPACE_READ_STATE_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
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

test("per-turn change sets, the turn diff scope and the turn.changed push are pinned to v80", () => {
	expect(TURN_CHANGES_PROTOCOL_VERSION).toBe(80);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(TURN_CHANGES_PROTOCOL_VERSION);
	expect(WS_METHODS.workspaceTurns).toBe("workspace.turns");
	expect(WS_CHANNELS.turnChanged).toBe("turn.changed");
});

test("the subagent concurrency limit is pinned to v79", () => {
	expect(SUBAGENT_CONCURRENCY_PROTOCOL_VERSION).toBe(79);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(SUBAGENT_CONCURRENCY_PROTOCOL_VERSION);
	expect(WS_METHODS.workspaceSetSubagentMaxConcurrent).toBe("workspace.setSubagentMaxConcurrent");
	expect(DEFAULT_CONFIG.subagentMaxConcurrent).toBe(SUBAGENT_MAX_CONCURRENT.default);
	expect(SUBAGENT_MAX_CONCURRENT).toEqual({ min: 1, max: 16, default: 4 });
	expect(isSubagentMaxConcurrent(1)).toBe(true);
	expect(isSubagentMaxConcurrent(16)).toBe(true);
	expect(isSubagentMaxConcurrent(0)).toBe(false);
	expect(isSubagentMaxConcurrent(17)).toBe(false);
	expect(isSubagentMaxConcurrent(2.5)).toBe(false);
	expect(isSubagentMaxConcurrent("4")).toBe(false);
});

test("the settled workspace shelf is pinned to v78", () => {
	expect(WORKSPACE_SETTLE_PROTOCOL_VERSION).toBe(78);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(WORKSPACE_SETTLE_PROTOCOL_VERSION);
	expect(WS_METHODS.workspaceSettle).toBe("workspace.settle");
	expect(WS_METHODS.workspaceUnsettle).toBe("workspace.unsettle");
	expect(DEFAULT_CONFIG.settleIdleDays).toBe(SETTLE_IDLE_DAYS.default);
	expect(isSettleIdleDays(null)).toBe(true);
	expect(isSettleIdleDays(3)).toBe(true);
	expect(isSettleIdleDays(0)).toBe(false);
	expect(isSettleIdleDays(2.5)).toBe(false);
	expect(isSettleIdleDays("3")).toBe(false);
});

test("picker metadata and host-kept favorites/recents are pinned to v77", () => {
	expect(MODEL_PICKER_PROTOCOL_VERSION).toBe(77);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MODEL_PICKER_PROTOCOL_VERSION);
	expect(DEFAULT_CONFIG.favoriteModels).toEqual([]);
	expect(DEFAULT_CONFIG.recentModels).toEqual([]);
	expect(RECENT_MODELS_LIMIT).toBe(5);
});

test("the extension catalog and its on/off setting are pinned to v82", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(EXTENSION_CATALOG_PROTOCOL_VERSION);
	expect(EXTENSION_CATALOG_PROTOCOL_VERSION).toBe(82);
	expect(WS_METHODS.extensionList).toBe("extension.list");
	expect(DEFAULT_CONFIG.disabledExtensions).toEqual([]);
});

test("the project trust summary and pi-level resource consent are pinned to v81", () => {
	expect(PROJECT_TRUST_PROTOCOL_VERSION).toBe(81);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(PROJECT_TRUST_PROTOCOL_VERSION);
	expect(WS_METHODS.projectTrustSummary).toBe("project.trustSummary");
});

test("workspace read state is pinned to v86", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(WORKSPACE_READ_STATE_PROTOCOL_VERSION);
	expect(WORKSPACE_READ_STATE_PROTOCOL_VERSION).toBe(86);
	expect(WS_METHODS.workspaceMarkUnread).toBe("workspace.markUnread");
	expect(WS_METHODS.workspaceMarkRead).toBe("workspace.markRead");
});

test("local language files and the locale setting are pinned to v89", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(LOCALES_PROTOCOL_VERSION);
	expect(LOCALES_PROTOCOL_VERSION).toBe(89);
	expect(WS_METHODS.localesList).toBe("locales.list");
	expect(WS_METHODS.localesReveal).toBe("locales.reveal");
	expect(WS_CHANNELS.localesChanged).toBe("locales.changed");
});

test("tool responses replace the ask-only answer method at v93", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(TOOL_RESPONSE_PROTOCOL_VERSION);
	expect(TOOL_RESPONSE_PROTOCOL_VERSION).toBe(93);
	expect(WS_METHODS.sessionRespondToTool).toBe("session.respondToTool");
	expect(WS_METHODS.sessionAnswerQuestion).toBe("session.answerQuestion");
});

test("user theme files are pinned to v92", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(USER_THEMES_PROTOCOL_VERSION);
	expect(USER_THEMES_PROTOCOL_VERSION).toBe(92);
	expect(WS_METHODS.themesList).toBe("themes.list");
	expect(WS_METHODS.themesReveal).toBe("themes.reveal");
	expect(WS_CHANNELS.themesChanged).toBe("themes.changed");
});

test("the stored host environment is pinned to v91", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(HOST_ENVIRONMENT_PROTOCOL_VERSION);
	expect(HOST_ENVIRONMENT_PROTOCOL_VERSION).toBe(91);
	expect(WS_METHODS.environmentGet).toBe("environment.get");
	expect(WS_METHODS.environmentUpdate).toBe("environment.update");
});

test("client error reports are pinned to v90", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(CLIENT_ERROR_REPORT_PROTOCOL_VERSION);
	expect(CLIENT_ERROR_REPORT_PROTOCOL_VERSION).toBe(90);
	expect(WS_METHODS.clientReportError).toBe("client.reportError");
});

test("project rename is pinned to v85", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(PROJECT_RENAME_PROTOCOL_VERSION);
	expect(PROJECT_RENAME_PROTOCOL_VERSION).toBe(85);
	expect(WS_METHODS.projectRename).toBe("project.rename");
});

test("branch status, review-free push, and PR description sources are pinned to v87", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(BRANCH_STATUS_PROTOCOL_VERSION);
	expect(BRANCH_STATUS_PROTOCOL_VERSION).toBe(87);
	expect(WS_METHODS.workspaceBranchStatus).toBe("workspace.branchStatus");
	expect(WS_METHODS.workspacePush).toBe("workspace.push");
	expect(WS_METHODS.prGenerate).toBe("pr.generate");
	expect(WS_METHODS.workspaceOpenReview).toBe("workspace.openReview");
});

test("review details and the GitHub review actions are pinned to v88", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(REVIEW_ACTIONS_PROTOCOL_VERSION);
	expect(REVIEW_ACTIONS_PROTOCOL_VERSION).toBe(88);
	expect(WS_METHODS.prReady).toBe("pr.ready");
	expect(WS_METHODS.prMerge).toBe("pr.merge");
	expect(WS_METHODS.prReopen).toBe("pr.reopen");
	expect(WS_METHODS.workspaceDeleteRemoteBranch).toBe("workspace.deleteRemoteBranch");
});

test("project create and the onboarding dismissal are pinned to v94", () => {
	expect(PROTOCOL_VERSION).toBe(94);
	expect(ONBOARDING_PROTOCOL_VERSION).toBe(94);
	expect(WS_METHODS.projectCreate).toBe("project.create");
	expect(WS_METHODS.providerDetect).toBe("provider.detect");
	expect(DEFAULT_CONFIG.onboardingDismissed).toBe(false);
});

test("MCP server management, status and chat resources are pinned to v83", () => {
	expect(MCP_PROTOCOL_VERSION).toBe(83);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MCP_PROTOCOL_VERSION);
	expect(WS_METHODS.mcpList).toBe("mcp.list");
	expect(WS_METHODS.mcpSetSessionOverride).toBe("mcp.setSessionOverride");
	expect(WS_METHODS.mcpLogin).toBe("mcp.login");
	expect(WS_METHODS.mcpReadOutput).toBe("mcp.readOutput");
	expect(WS_METHODS.mcpReadLog).toBe("mcp.readLog");
	expect(WS_CHANNELS.mcpStatus).toBe("mcp.status");
	expect(WS_METHODS).not.toHaveProperty("mcpStop");
});

test("always-allowed MCP tools and their revoke are pinned to v84", () => {
	expect(MCP_TOOL_GRANTS_PROTOCOL_VERSION).toBe(84);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MCP_TOOL_GRANTS_PROTOCOL_VERSION);
	expect(WS_METHODS.mcpRevokeToolGrant).toBe("mcp.revokeToolGrant");
});

test("rich review anchors advance the additive selector union to v74", () => {
	expect(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION).toBe(74);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION);
	expect(WS_METHODS.reviewCommentAdd).toBe("review.commentAdd");
});

test("change mutations name their two methods at v75", () => {
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(75);
	expect(CHANGE_MUTATIONS_PROTOCOL_VERSION).toBe(75);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(CHANGE_MUTATIONS_PROTOCOL_VERSION);
	expect(WS_METHODS.changeRevert).toBe("change.revert");
	expect(WS_METHODS.changeUndo).toBe("change.undo");
});

test("model context settings name their two methods at v76", () => {
	expect(WS_METHODS.modelContextSettings).toBe("model.contextSettings");
	expect(WS_METHODS.modelSetContextWindow).toBe("model.setContextWindow");
	expect(CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION).toBe(76);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION);
});

test("resource metadata rides the two content reads from v75", () => {
	expect(RESOURCE_META_PROTOCOL_VERSION).toBe(75);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(RESOURCE_META_PROTOCOL_VERSION);
	expect(WS_METHODS.fsReadFile).toBe("fs.readFile");
	expect(WS_METHODS.gitDiffFile).toBe("git.diffFile");
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

describe("completionDelivery", () => {
	test("reads the delivery marker and treats a missing or unknown value as absent", () => {
		expect(completionDelivery({ delivery: "wake" })).toBe("wake");
		expect(completionDelivery({ delivery: "run" })).toBe("run");
		expect(completionDelivery({ delivery: "appended" })).toBe("appended");
		expect(completionDelivery({})).toBeUndefined();
		expect(completionDelivery({ delivery: "later" })).toBeUndefined();
	});
});

describe("tool response guards", () => {
	test("isToolResponsePending recognises the pending marker only", () => {
		expect(isToolResponsePending({ kind: "ack" })).toBe(true);
		expect(isToolResponsePending({ kind: "other" })).toBe(false);
		expect(isToolResponsePending({ answers: [], cancelled: true })).toBe(false);
		expect(isToolResponsePending(undefined)).toBe(false);
		expect(isToolResponsePending("ack")).toBe(false);
	});

	test("readToolResponseMessage reads the tool-response custom message", () => {
		const message = {
			role: "custom",
			customType: TOOL_RESPONSE_CUSTOM_TYPE,
			details: { toolCallId: "tc", response: { picked: "A" } },
		};
		expect(readToolResponseMessage(message)).toEqual({
			toolCallId: "tc",
			response: { picked: "A" },
		});
		expect(readToolResponseMessage({ ...message, customType: "other" })).toBeNull();
		expect(readToolResponseMessage({ ...message, details: { toolCallId: "tc" } })).toBeNull();
		expect(readToolResponseMessage({ ...message, details: { response: {} } })).toBeNull();
		expect(readToolResponseMessage({ ...message, role: "user" })).toBeNull();
		expect(readToolResponseMessage(null)).toBeNull();
	});

	test("readToolResponseMessage still reads the legacy ask-user-answers shape", () => {
		const result = { answers: [], cancelled: true };
		expect(
			readToolResponseMessage({
				role: "custom",
				customType: "ask-user-answers",
				details: { toolCallId: "tc", result },
			}),
		).toEqual({ toolCallId: "tc", response: result });
		expect(
			readToolResponseMessage({
				role: "custom",
				customType: "ask-user-answers",
				details: { toolCallId: "tc" },
			}),
		).toBeNull();
	});
});
