import { expect, test } from "bun:test";
import type {
	IssueConnection,
	IssueConnectionInput,
	IssueList,
	IssueSessionLaunch,
	IssueSummary,
} from "@thinkrail/contracts";
import { EN, type MessageKey } from "@thinkrail/locales";
import { Dialog } from "@thinkrail/ui/dialog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitLabAssociationBody } from "./GitLabAssociationDialog";
import { GitLabAssociationForm } from "./GitLabAssociationForm";
import { IssuesPanel, type IssuesPanelProps } from "./IssuesPanel";
import {
	associationDismissal,
	associationFormState,
	associationPanelInitialState,
	associationPanelState,
	type ConnectResult,
	ISSUE_ACTION_KEY,
	ISSUE_ACTION_REASON_KEY,
	ISSUE_ERROR_KEY,
	type IssueActionCall,
	type IssueActionCapabilities,
	type IssueActionId,
	type IssueActionResult,
	type IssuePanelError,
	isSshRepositoryAddress,
	issueActionCall,
	issueActions,
	issueAddressNotice,
	issueConnectionInput,
	issueHttpConsent,
	issueKey,
	issueSnapshotAfterLoad,
	loadIssueSnapshot,
	notifyIssueAssociation,
	reconnectOutcome,
	resolveIssueConnectionAddress,
	runIssueAction,
	safeIssueUrl,
	shouldPromptAssociation,
	submitConnection,
	submitDisconnect,
	subscribeIssueAssociation,
	supportsIssueActions,
	supportsIssueApproval,
	supportsIssueAuth,
	supportsIssueImplementation,
	supportsIssues,
} from "./model";

/** Catalog text by key, so assertions do not restate English wording. */
const text = (key: MessageKey): string => EN[key] ?? key;

const connected: IssueConnection = {
	projectId: "local-project",
	instanceUrl: "https://gitlab.com",
	remoteProjectId: "42",
	connected: true,
};

const summary: IssueSummary = {
	reference: { provider: "gitlab", instanceUrl: "https://gitlab.com", projectId: "1", number: 1 },
	title: "First issue",
	url: "https://gitlab.com/a/issues/1",
	labels: ["blocked"],
	stage: "backlog",
	updatedAt: "",
};

const capable: IssueActionCapabilities = {
	actionsSupported: true,
	implementationSupported: true,
	trusted: true,
};

function renderIssues(
	props: {
		connection?: IssueConnection | null;
		issues?: readonly IssueSummary[];
		pending?: boolean;
		authSupported?: boolean;
		error?: IssuePanelError;
		onOpenIssue?: (reference: IssueSummary["reference"]) => void;
		capabilities?: IssueActionCapabilities;
		onRunAction?: (issue: IssueSummary, action: IssueActionId) => Promise<IssueActionResult>;
		actionPending?: boolean;
		actionError?: IssuePanelError | null;
		actionErrorIssue?: string;
	} = {},
): string {
	const full: IssuesPanelProps = {
		connection: props.connection ?? null,
		issues: props.issues ?? [],
		pending: props.pending ?? false,
		authSupported: props.authSupported ?? true,
		capabilities: props.capabilities ?? capable,
		error: props.error,
		onConnect: async (): Promise<ConnectResult> => ({ ok: true }),
		onDisconnect: async () => {},
		onRefresh: () => {},
		onOpenIssue: props.onOpenIssue,
		onRunAction: props.onRunAction,
		actionPending: props.actionPending,
		actionError: props.actionError,
		actionErrorIssue: props.actionErrorIssue,
	};
	return renderToStaticMarkup(createElement(IssuesPanel, full));
}

function renderForm(
	props: {
		connection?: IssueConnection | null;
		initialRepositoryUrl?: string | null;
		initialAcknowledgedInstance?: string | null;
	} = {},
): string {
	return renderToStaticMarkup(
		createElement(GitLabAssociationForm, {
			connection: props.connection ?? null,
			initialRepositoryUrl: props.initialRepositoryUrl,
			initialAcknowledgedInstance: props.initialAcknowledgedInstance,
			pending: false,
			authSupported: true,
			onConnect: async (): Promise<ConnectResult> => ({ ok: true }),
		}),
	);
}

test("read/connect is gated at protocol v103", () => {
	expect(supportsIssues(null)).toBe(false);
	expect(supportsIssues(102)).toBe(false);
	expect(supportsIssues(103)).toBe(true);
	expect(supportsIssues(105)).toBe(true);
});

test("a durable association needs the v105 auth floor, reads do not", () => {
	expect(supportsIssueAuth(null)).toBe(false);
	expect(supportsIssueAuth(102)).toBe(false);
	expect(supportsIssueAuth(103)).toBe(false);
	expect(supportsIssueAuth(104)).toBe(false);
	expect(supportsIssueAuth(105)).toBe(true);
	expect(supportsIssueAuth(106)).toBe(true);
});

test("a v103 host keeps the stored metadata but disables the connect form", () => {
	const html = renderIssues({
		connection: { ...connected, connected: false },
		authSupported: false,
	});
	expect(html).toContain("https://gitlab.com");
	expect(html).toContain("42");
	expect(html).toContain(text("issues.authUnsupported"));
	expect(html).toMatch(/data-testid="issues-connect"[^>]*disabled/);
});

test("a v105 host offers the repository address form", () => {
	const html = renderIssues({ authSupported: true });
	expect(html).toContain('data-testid="issues-address"');
	expect(html).not.toContain(text("issues.authUnsupported"));
	expect(html).toMatch(/data-testid="issues-connect"[^>]*disabled/);
});

test("a v103 host keeps metadata but claims no vault and invites no reconnect", () => {
	for (const connection of [{ ...connected, connected: false }, connected]) {
		const html = renderIssues({ connection, authSupported: false });
		expect(html).toContain("https://gitlab.com");
		expect(html).toContain("42");
		expect(html).toContain(text("issues.authUnsupported"));
		expect(html).not.toContain(text("issues.tokenVault"));
		expect(html).not.toContain(text("issues.reconnectHint"));
		expect(html).not.toContain('data-testid="issues-reconnect"');
	}
});

test("association form state derives its target, consent and submit gating", () => {
	const fields = {
		connection: null,
		address: "https://gitlab.com/group/repo.git",
		instanceOverride: null,
		advancedOpen: false,
		acknowledged: null,
		token: "glpat-1",
		pending: false,
		authSupported: true,
	};
	const secure = associationFormState(fields);
	expect(secure.target).toEqual({ instanceUrl: "https://gitlab.com", projectId: "group/repo" });
	expect(secure.consentRequired).toBe(false);
	expect(secure.consentAcknowledged).toBe(false);
	expect(secure.canSubmit).toBe(true);
	expect(secure.input).toEqual({
		instanceUrl: "https://gitlab.com",
		projectId: "group/repo",
		token: "glpat-1",
	});

	const http = {
		...connected,
		instanceUrl: "http://code.example",
		remoteProjectId: "group/repo",
		connected: false,
	};
	const required = associationFormState({ ...fields, connection: http, address: "" });
	expect(required.target).toEqual({ instanceUrl: "http://code.example", projectId: "group/repo" });
	expect(required.consentRequired).toBe(true);
	expect(required.consentAcknowledged).toBe(false);
	expect(required.input).toBeNull();
	expect(required.canSubmit).toBe(false);
	const acknowledged = associationFormState({
		...fields,
		connection: http,
		address: "",
		acknowledged: "http://code.example",
	});
	expect(acknowledged.consentAcknowledged).toBe(true);
	expect(acknowledged.canSubmit).toBe(true);
	expect(acknowledged.input?.httpConsent).toEqual({ instanceUrl: "http://code.example" });
	expect(
		associationFormState({
			...fields,
			connection: http,
			address: "",
			acknowledged: "http://code.example",
			authSupported: false,
		}).canSubmit,
	).toBe(false);
	expect(
		associationFormState({
			...fields,
			connection: http,
			address: "",
			acknowledged: "http://code.example",
			pending: true,
		}).canSubmit,
	).toBe(false);
});

test("reconnect closes only after connect success and keeps a keyed failure open", () => {
	const editing = reconnectOutcome(associationPanelInitialState, { type: "startReconnect" });
	expect(editing).toEqual({ reconnecting: true, actionError: null, snapshotError: null });
	expect(reconnectOutcome(editing, { type: "connectFailed", error: "connect" })).toEqual({
		reconnecting: true,
		actionError: "connect",
		snapshotError: null,
	});
	expect(reconnectOutcome(editing, { type: "connectSucceeded" })).toEqual({
		reconnecting: false,
		actionError: null,
		snapshotError: null,
	});
	expect(reconnectOutcome(editing, { type: "cancelReconnect" })).toEqual({
		reconnecting: false,
		actionError: null,
		snapshotError: null,
	});
});

test("a list failure after a connected reconnect is not a connect failure", () => {
	const connectedState = reconnectOutcome(
		reconnectOutcome(associationPanelInitialState, { type: "startReconnect" }),
		{ type: "connectSucceeded" },
	);
	expect(reconnectOutcome(connectedState, { type: "snapshotLanded", error: "list" })).toEqual({
		reconnecting: false,
		actionError: null,
		snapshotError: "list",
	});
	expect(
		reconnectOutcome(
			{ reconnecting: false, actionError: "disconnect", snapshotError: null },
			{ type: "snapshotLanded", error: null },
		),
	).toEqual({ reconnecting: false, actionError: null, snapshotError: null });
	expect(
		reconnectOutcome(
			{ reconnecting: false, actionError: "disconnect", snapshotError: null },
			{ type: "snapshotLanded", error: "list" },
		),
	).toEqual({ reconnecting: false, actionError: "disconnect", snapshotError: "list" });
	expect(
		reconnectOutcome(
			{ reconnecting: false, actionError: "disconnect", snapshotError: null },
			{ type: "clearActionError" },
		),
	).toEqual({ reconnecting: false, actionError: null, snapshotError: null });
});

test("cancelling a reconnect clears the snapshot-level connect error with the form", () => {
	const failed = reconnectOutcome(
		{ ...associationPanelState(null), reconnecting: true },
		{ type: "connectFailed", error: "connect" },
	);
	expect(failed).toEqual({ reconnecting: true, actionError: "connect", snapshotError: null });
	const landed = reconnectOutcome(failed, { type: "snapshotLanded", error: "connect" });
	expect(landed).toEqual({ reconnecting: true, actionError: "connect", snapshotError: "connect" });
	for (const state of [failed, landed])
		expect(reconnectOutcome(state, { type: "cancelReconnect" })).toEqual({
			reconnecting: false,
			actionError: null,
			snapshotError: null,
		});
	expect(
		reconnectOutcome(associationPanelState("list"), { type: "snapshotLanded", error: "list" }),
	).toEqual({ reconnecting: false, actionError: null, snapshotError: "list" });
	expect(
		reconnectOutcome(associationPanelState("connect"), { type: "snapshotLanded", error: null }),
	).toEqual({ reconnecting: false, actionError: null, snapshotError: null });
});

test("a failed reconnect keeps the summaries the tool was reconnecting to", () => {
	const identity = "project-1:4:connected:true:true";
	const previous = {
		identity,
		connection: connected,
		issues: [summary],
		pending: true,
		error: null,
	};
	const failed = { connection: null, issues: [], error: "connect" as const };
	expect(issueSnapshotAfterLoad(previous, identity, failed)).toEqual({
		identity,
		connection: connected,
		issues: [summary],
		pending: false,
		error: "connect",
	});
	expect(issueSnapshotAfterLoad(null, identity, failed)).toEqual({
		identity,
		connection: null,
		issues: [],
		pending: false,
		error: "connect",
	});
	expect(issueSnapshotAfterLoad(previous, "other:4:connected:true:true", failed)).toEqual({
		identity: "other:4:connected:true:true",
		connection: null,
		issues: [],
		pending: false,
		error: "connect",
	});
	expect(
		issueSnapshotAfterLoad(previous, identity, {
			connection: connected,
			issues: [summary],
			error: null,
		}),
	).toEqual({ identity, connection: connected, issues: [summary], pending: false, error: null });
	expect(
		issueSnapshotAfterLoad(previous, identity, {
			connection: connected,
			issues: [],
			error: "list",
		}),
	).toEqual({ identity, connection: connected, issues: [], pending: false, error: "list" });
});

test("non-local HTTP renders its risk checkbox unchecked until acknowledged", () => {
	const http = {
		...connected,
		instanceUrl: "http://code.example",
		remoteProjectId: "group/repo",
		connected: false,
	};
	const required = renderForm({ connection: http });
	expect(required).toContain(
		(EN["issues.httpRisk"] ?? "").replace("{{instance}}", "http://code.example"),
	);
	expect(required).toContain('data-testid="issues-http-risk"');
	expect(required).toContain('data-testid="issues-http-consent"');
	expect(required).not.toMatch(/data-testid="issues-http-consent"[^>]*checked/);
	const acknowledged = renderForm({
		connection: http,
		initialAcknowledgedInstance: "http://code.example",
	});
	expect(acknowledged).toMatch(/data-testid="issues-http-consent"[^>]*checked/);
});

test("a supplied open-issue callback renders the launch control", () => {
	const withCallback = renderIssues({
		connection: connected,
		issues: [summary],
		onOpenIssue: () => {},
	});
	expect(withCallback).toContain(text("issues.open"));
	expect(renderIssues({ connection: connected, issues: [summary] })).not.toContain(
		text("issues.open"),
	);
});

test("external titles accept only http(s)", () => {
	expect(safeIssueUrl("javascript:alert(1)")).toBeUndefined();
	expect(safeIssueUrl("https://gitlab.com/a/issues/1")).toBe("https://gitlab.com/a/issues/1");
});

test("ssh and scp addresses are rejected with HTTPS guidance", () => {
	for (const address of [
		"git@gitlab.com:group/repo.git",
		"gitlab.com:group/repo.git",
		"ssh://git@gitlab.com/group/repo.git",
		"git+ssh://git@code.example/group/repo.git",
	])
		expect(resolveIssueConnectionAddress(address)).toEqual({ status: "invalid", reason: "ssh" });
	for (const address of ["https://gitlab.com/group/repo.git", "https://code.example/group/repo"])
		expect(isSshRepositoryAddress(address)).toBe(false);
	expect(isSshRepositoryAddress("git@gitlab.com:group/repo.git")).toBe(true);
	expect(resolveIssueConnectionAddress("")).toEqual({ status: "invalid", reason: "empty" });
	expect(resolveIssueConnectionAddress("file:///group/repo")).toEqual({
		status: "invalid",
		reason: "unsupported",
	});
	expect(issueAddressNotice(resolveIssueConnectionAddress("git@gitlab.com:group/repo.git"))).toBe(
		"issues.addressSsh",
	);
	expect(issueAddressNotice(resolveIssueConnectionAddress("file:///group/repo"))).toBe(
		"issues.addressInvalid",
	);
	expect(issueAddressNotice(resolveIssueConnectionAddress(""))).toBeNull();
	expect(issueAddressNotice(resolveIssueConnectionAddress("https://gitlab.com/g/r"))).toBeNull();
	expect(renderIssues()).toContain("SSH addresses are not supported");
});

test("HTTP consent is required only for non-local HTTP and bound to the canonical instance", () => {
	const secure = { instanceUrl: "https://gitlab.example/team", projectId: "group/repo" };
	const built = issueConnectionInput(secure, "glpat-1", null);
	expect(built).toEqual({ ...secure, token: "glpat-1" });
	expect(built && Object.hasOwn(built, "httpConsent")).toBe(false);
	expect(
		Object.hasOwn(
			issueConnectionInput({ instanceUrl: "http://localhost:8080", projectId: "g/r" }, "t", null) ??
				{},
			"httpConsent",
		),
	).toBe(false);
	const clear: IssueConnectionInput | null = issueConnectionInput(
		{ instanceUrl: "http://code.example", projectId: "g/r" },
		"t",
		null,
	);
	expect(clear).toBeNull();
	expect(
		issueConnectionInput(
			{ instanceUrl: "http://code.example", projectId: "g/r" },
			"t",
			"http://code.example",
		),
	).toEqual({
		instanceUrl: "http://code.example",
		projectId: "g/r",
		token: "t",
		httpConsent: { instanceUrl: "http://code.example" },
	});
	expect(
		issueConnectionInput(
			{ instanceUrl: "http://code.example:8080/gitlab", projectId: "g/r" },
			"t",
			"http://code.example",
		),
	).toBeNull();
	expect(
		issueConnectionInput(
			{ instanceUrl: "https://code.example", projectId: "g/r" },
			"t",
			"http://code.example",
		),
	).toEqual({ instanceUrl: "https://code.example", projectId: "g/r", token: "t" });
	expect(issueHttpConsent("http://code.example/", "http://code.example")).toEqual({
		instanceUrl: "http://code.example",
	});
});

test("changing the instance drops the previous acknowledgment", () => {
	const acknowledged = "http://a.example";
	expect(issueHttpConsent("http://a.example", acknowledged)).toEqual({ instanceUrl: acknowledged });
	expect(issueHttpConsent("http://b.example", acknowledged)).toBeUndefined();
	expect(
		issueConnectionInput({ instanceUrl: "http://b.example", projectId: "g/r" }, "t", acknowledged),
	).toBeNull();
	expect(issueHttpConsent("https://a.example", acknowledged)).toBeUndefined();
});

test("no connect input is built from a blank token or unsafe coordinates", () => {
	const target = { instanceUrl: "https://gitlab.com", projectId: "group/repo" };
	expect(issueConnectionInput(target, "", null)).toBeNull();
	expect(issueConnectionInput(target, "   ", null)).toBeNull();
	expect(issueConnectionInput(target, "gl\npat", null)).toBeNull();
	expect(issueConnectionInput(target, "glpat-1", null)).toEqual({ ...target, token: "glpat-1" });
	for (const projectId of ["", "group/../repo", "group//repo", "group/repo?x", "  group/repo"])
		expect(
			issueConnectionInput({ instanceUrl: "https://gitlab.com", projectId }, "glpat-1", null),
		).toBeNull();
	expect(
		issueConnectionInput({ instanceUrl: "git@gitlab.com:group/repo", projectId: "g/r" }, "t", null),
	).toBeNull();
});

test("token is cleared before a connect request, including rejection", async () => {
	const events: string[] = [];
	await expect(
		submitConnection(
			{ instanceUrl: "https://gitlab.com", projectId: "a/b", token: "secret" },
			() => events.push("clear"),
			async (input) => {
				events.push(input.token);
				throw new Error("failed");
			},
		),
	).rejects.toThrow("failed");
	expect(events).toEqual(["clear", "secret"]);
});

test("a list failure after a successful connect keeps the association", async () => {
	const issues: IssueList = { issues: [summary], fetchedAt: "" };
	expect(
		await loadIssueSnapshot({
			connection: async () => null,
			connect: async () => connected,
			list: async () => {
				throw new Error("503");
			},
		}),
	).toEqual({ connection: connected, issues: [], error: "list" });
	expect(
		await loadIssueSnapshot({
			connection: async () => connected,
			list: async () => issues,
		}),
	).toEqual({ connection: connected, issues: [summary], error: null });
});

test("a failed connect is a connect failure, never a list failure", async () => {
	const issues: IssueList = { issues: [summary], fetchedAt: "" };
	expect(
		await loadIssueSnapshot({
			connection: async () => null,
			connect: async () => {
				throw new Error("403");
			},
			list: async () => issues,
		}),
	).toEqual({ connection: null, issues: [], error: "connect" });
	expect(
		await loadIssueSnapshot({
			connection: async () => {
				throw new Error("offline");
			},
			list: async () => issues,
		}),
	).toEqual({ connection: null, issues: [], error: "read" });
});

test("a read that goes stale is dropped instead of published", async () => {
	let current = true;
	const dropped = await loadIssueSnapshot(
		{
			connection: async () => {
				current = false;
				return connected;
			},
			list: async () => ({ issues: [summary], fetchedAt: "" }),
		},
		() => current,
	);
	expect(dropped).toBeNull();
});

test("disconnect reports failure instead of success, only after the host answers", async () => {
	const events: string[] = [];
	const failed = await submitDisconnect(async () => {
		events.push("disconnect");
		throw new Error("vault locked");
	});
	events.push("after");
	expect(failed).toBe(false);
	expect(events).toEqual(["disconnect", "after"]);
	expect(await submitDisconnect(async () => {})).toBe(true);
});

test("panel errors are i18n keys, never transport text", () => {
	expect(ISSUE_ERROR_KEY).toEqual({
		read: "issues.failed",
		connect: "issues.error.connect",
		list: "issues.error.list",
		disconnect: "issues.error.disconnect",
		open: "issues.error.open",
		action: "issues.error.action",
		unsupported: "issues.error.unsupported",
	});
	for (const error of Object.keys(ISSUE_ERROR_KEY) as IssuePanelError[]) {
		const html = renderIssues({ error, connection: connected });
		expect(html).toContain(text(ISSUE_ERROR_KEY[error]));
	}
});

test("a list failure after connecting still shows the association", () => {
	const html = renderIssues({ connection: connected, issues: [summary], error: "list" });
	expect(html).toContain(text("issues.error.list"));
	expect(html).toContain(text("issues.connected"));
	expect(html).not.toContain(text("issues.error.connect"));
});

test("a disconnect failure renders its own error", () => {
	const html = renderIssues({ connection: connected, error: "disconnect" });
	expect(html).toContain(text("issues.error.disconnect"));
	expect(html).not.toContain(text("issues.error.list"));
	expect(html).toContain('data-testid="issues-disconnect"');
});

test("a stored association offers reconnect with read-only coordinates", () => {
	const html = renderIssues({ connection: { ...connected, connected: false } });
	expect(html).toContain('data-testid="issues-reconnect-instance"');
	expect(html).toContain('data-testid="issues-reconnect-project"');
	expect(html).toMatch(/data-testid="issues-reconnect-instance"[^>]*readOnly/);
	expect(html).toMatch(/data-testid="issues-reconnect-project"[^>]*readOnly/);
	expect(html).toContain(text("issues.reconnectHint"));
	expect(html).toContain(text("issues.tokenVault"));
	expect(html).toContain('data-testid="issues-token"');
	expect(html).not.toContain('data-testid="issues-address"');
});

test("read-only summaries expose links and status but no fake stage actions", () => {
	const html = renderIssues({ issues: [summary] });
	expect(html).toContain('rel="noopener noreferrer"');
	expect(html).toContain("First issue");
	expect(html).toContain("blocked");
	expect(html).not.toContain("Implement");
});

function renderAssociation(
	initialRepositoryUrl?: string | null,
	options: { pending?: boolean } = {},
): string {
	return renderToStaticMarkup(
		createElement(
			Dialog,
			{ open: true },
			createElement(GitLabAssociationBody, {
				projectId: "local-project",
				initialRepositoryUrl,
				onClose: () => {},
				pending: options.pending ?? false,
				onPendingChange: () => {},
			}),
		),
	);
}

test("dual entry: only gestures that adopt an existing repository offer the association", () => {
	expect(shouldPromptAssociation("open")).toBe(true);
	expect(shouldPromptAssociation("init")).toBe(true);
	expect(shouldPromptAssociation("clone")).toBe(true);
	expect(shouldPromptAssociation("create")).toBe(false);
});

test("the post-open prompt is skippable and reuses the one association form", () => {
	const html = renderAssociation("https://gitlab.com/group/repo.git");
	expect(html).toContain(text("issues.associateTitle"));
	expect(html).toContain(text("issues.associateDescription"));
	expect(html).toContain(text("issues.associateSkip"));
	expect(html).toContain('data-testid="issues-associate-skip"');
	expect(html).toMatch(
		/data-testid="issues-address"[^>]*value="https:\/\/gitlab.com\/group\/repo.git"/,
	);
	expect(html).toMatch(/data-testid="issues-address"[^>]*autoComplete="off"/);
	expect(html.match(/data-testid="issues-token"/g)?.length).toBe(1);
	expect(html.match(/data-testid="issues-connect"/g)?.length).toBe(1);
	expect(html).not.toContain(text("issues.authUnsupported"));
	expect(html).not.toContain(text("issues.error.connect"));
	expect(html).toMatch(/data-testid="issues-connect"[^>]*disabled/);
});

test("an empty or unusable hint still opens the same skippable form", () => {
	for (const hint of [null, "git@gitlab.com:group/repo.git"]) {
		const html = renderAssociation(hint);
		expect(html).toContain('data-testid="issues-associate-skip"');
		expect(html).toContain('data-testid="issues-address"');
	}
	expect(renderAssociation(null)).not.toContain("git@");
	expect(renderAssociation("git@gitlab.com:group/repo.git")).toContain(text("issues.addressSsh"));
});

test("a pending connect cannot be dismissed from the post-open prompt", () => {
	let closed = 0;
	const close = () => {
		closed++;
	};
	const idle = associationDismissal(false, close);
	expect(idle.hideClose).toBe(false);
	idle.onOpenChange(true);
	expect(closed).toBe(0);
	idle.onOpenChange(false);
	expect(closed).toBe(1);
	const unblocked = { prevented: false, preventDefault: () => {} };
	idle.onEscapeKeyDown(unblocked);
	idle.onInteractOutside(unblocked);
	expect(unblocked.prevented).toBe(false);

	const pending = associationDismissal(true, close);
	expect(pending.hideClose).toBe(true);
	pending.onOpenChange(false);
	expect(closed).toBe(1);
	const escapeEvent = {
		prevented: false,
		preventDefault() {
			this.prevented = true;
		},
	};
	pending.onEscapeKeyDown(escapeEvent);
	expect(escapeEvent.prevented).toBe(true);
	const outsideEvent = {
		prevented: false,
		preventDefault() {
			this.prevented = true;
		},
	};
	pending.onInteractOutside(outsideEvent);
	expect(outsideEvent.prevented).toBe(true);
});

test("a pending connect keeps the skip control present but disabled", () => {
	const idle = renderAssociation(null);
	expect(idle).toMatch(/data-testid="issues-associate-skip"(?![^>]*disabled)/);
	const pending = renderAssociation(null, { pending: true });
	expect(pending).toMatch(/data-testid="issues-associate-skip"[^>]*disabled/);
	expect(pending).toContain(text("issues.associateSkip"));
	expect(pending).toMatch(/data-testid="issues-connect"[^>]*disabled/);
	expect(pending).toContain(text("issues.associateTitle"));
	expect(pending).not.toContain(text("issues.error.connect"));
});

test("the advanced disclosure renders only where it can change state", () => {
	const fields = {
		connection: null,
		address: "",
		instanceOverride: null,
		advancedOpen: false,
		acknowledged: null,
		token: "glpat-1",
		pending: false,
		authSupported: true,
	};
	const root = associationFormState({
		...fields,
		address: "https://gitlab.com/group/repo.git",
	});
	expect(root.showAdvanced).toBe(false);
	expect(root.advancedToggle).toBe(true);
	const opened = associationFormState({
		...fields,
		address: "https://gitlab.com/group/repo.git",
		advancedOpen: true,
	});
	expect(opened.showAdvanced).toBe(true);
	expect(opened.advancedToggle).toBe(true);
	const forced = associationFormState({
		...fields,
		address: "https://code.example/gitlab/group/repo.git",
	});
	expect(forced.showAdvanced).toBe(true);
	expect(forced.advancedToggle).toBe(false);
	expect(forced.base.status).toBe("needs-instance");
	expect(associationFormState(fields).advancedToggle).toBe(true);
});

test("the force-opened disclosure still shows its instance and project fields", () => {
	const html = renderForm({ initialRepositoryUrl: "https://code.example/gitlab/group/repo.git" });
	expect(html).toContain('data-testid="issues-instance"');
	expect(html).toContain('data-testid="issues-project"');
	expect(html).not.toContain("aria-expanded");
	expect(html).not.toContain(text("issues.advanced"));
	const toggleable = renderForm({ initialRepositoryUrl: "https://gitlab.com/group/repo.git" });
	expect(toggleable).toContain('aria-expanded="false"');
	expect(toggleable).toContain(text("issues.advanced"));
	expect(toggleable).not.toContain('data-testid="issues-instance"');
});

test("a post-open association reaches only the subscribed tool", () => {
	const heard: string[] = [];
	const unsubscribe = subscribeIssueAssociation((projectId) => heard.push(projectId));
	notifyIssueAssociation("local-project");
	expect(heard).toEqual(["local-project"]);
	unsubscribe();
	notifyIssueAssociation("local-project");
	expect(heard).toEqual(["local-project"]);
});

const inProgress: IssueSummary = { ...summary, stage: "in-progress" };

function callSpy(overrides: Partial<IssueActionCall> = {}): {
	call: IssueActionCall;
	calls: string[];
} {
	const calls: string[] = [];
	return {
		calls,
		call: {
			launchDesign: async () => {
				calls.push("design");
				return { workspaceId: "w1", sessionId: "s1" };
			},
			startImplementation: async () => {
				calls.push("implement");
				return { workspaceId: "w2", sessionId: "s2" };
			},
			...overrides,
		},
	};
}

test("stage actions follow the v104 launch and v106 approval floors", () => {
	expect(supportsIssueActions(null)).toBe(false);
	expect(supportsIssueActions(103)).toBe(false);
	expect(supportsIssueActions(104)).toBe(true);
	expect(supportsIssueApproval(104)).toBe(false);
	expect(supportsIssueApproval(105)).toBe(false);
	expect(supportsIssueApproval(106)).toBe(true);
});

test("the action matrix offers only design and implementation, and marks finished steps", () => {
	const full: IssueActionCapabilities = capable;
	expect(issueActions({ stage: "backlog" }, full)).toEqual([
		{ action: "design", reason: null, done: false },
		{ action: "implement", reason: null, done: false },
	]);
	expect(issueActions({ stage: "in-progress" }, full)).toEqual([
		{ action: "design", reason: null, done: true },
		{ action: "implement", reason: null, done: false },
	]);
	expect(issueActions({ stage: "in-review" }, full)).toEqual([
		{ action: "design", reason: null, done: true },
		{ action: "implement", reason: null, done: true },
	]);
	expect(issueActions({ stage: "closed" }, full)).toEqual([]);
	const older = { ...full, actionsSupported: false };
	expect(issueActions({ stage: "in-progress" }, older)).toEqual([
		{ action: "design", reason: "needs-newer-host", done: true },
		{ action: "implement", reason: null, done: false },
	]);
});

test("every action and reason has catalog text", () => {
	for (const key of Object.values(ISSUE_ACTION_KEY)) expect(EN[key]).toBeTruthy();
	for (const key of Object.values(ISSUE_ACTION_REASON_KEY)) expect(EN[key]).toBeTruthy();
	expect(Object.keys(ISSUE_ACTION_KEY)).toEqual(["design", "implement"]);
});

test("an in-progress issue shows both controls with no reason on a current host", () => {
	const html = renderIssues({
		connection: connected,
		issues: [inProgress],
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	for (const action of ["design", "implement"] as const) {
		expect(html).toContain(`data-testid="issue-action-${action}"`);
		expect(html).toContain(`aria-label="${text(ISSUE_ACTION_KEY[action])}"`);
		expect(html).not.toMatch(new RegExp(`data-testid="issue-action-${action}"[^>]*data-reason`));
		expect(html).not.toMatch(new RegExp(`data-testid="issue-action-${action}"[^>]*disabled`));
	}
	expect(html).toMatch(/data-testid="issue-action-design"[^>]*data-done="true"/);
	expect(html).not.toMatch(/data-testid="issue-action-implement"[^>]*data-done/);
	expect(html).toContain("First issue");
	expect(html.match(/data-testid="issue-actions"/g)?.length).toBe(1);
	expect(html.toLowerCase()).not.toContain("merge");
	expect(html).not.toContain("MR");
});

test("a backlog issue still offers implementation, because the two stages interleave", () => {
	const html = renderIssues({
		connection: connected,
		issues: [summary],
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	for (const action of ["design", "implement"])
		expect(html).not.toMatch(new RegExp(`data-testid="issue-action-${action}"[^>]*data-reason`));
	for (const action of ["design", "implement"])
		expect(html).not.toMatch(new RegExp(`data-testid="issue-action-${action}"[^>]*data-done`));
});

test("a host below the design-launch floor disables only the design control", () => {
	const html = renderIssues({
		connection: connected,
		issues: [inProgress],
		capabilities: { ...capable, actionsSupported: false },
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	expect(html).toMatch(/data-testid="issue-action-design"[^>]*data-reason="needs-newer-host"/);
	expect(html).not.toMatch(/data-testid="issue-action-implement"[^>]*data-reason/);
});

test("a closed issue offers no stage action at all", () => {
	const html = renderIssues({
		connection: connected,
		issues: [{ ...summary, stage: "closed" }],
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	expect(html).toContain("First issue");
	expect(html).not.toContain('data-testid="issue-actions"');
	for (const action of ["design", "approve-design", "implement", "approve-implementation"])
		expect(html).not.toContain(`data-testid="issue-action-${action}"`);
});

test("without a dispatch callback no stage action renders", () => {
	const html = renderIssues({ connection: connected, issues: [inProgress] });
	expect(html).not.toContain('data-testid="issue-actions"');
});

test("a pending action disables every control", () => {
	const html = renderIssues({
		connection: connected,
		issues: [inProgress],
		actionPending: true,
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	for (const action of ["design", "implement"])
		expect(html).toMatch(new RegExp(`data-testid="issue-action-${action}"[^>]*disabled`));
});

test("a tool-driven action error renders its key and never transport text or a token", () => {
	const html = renderIssues({
		connection: connected,
		issues: [inProgress],
		actionError: "action",
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	expect(html).toContain(text("issues.error.action"));
	expect(html).not.toContain("glpat");
	expect(html).not.toContain("RESOURCE_UNAVAILABLE");
});

test("the implementation start is gated at protocol v108", () => {
	expect(supportsIssueImplementation(null)).toBe(false);
	expect(supportsIssueImplementation(103)).toBe(false);
	expect(supportsIssueImplementation(104)).toBe(false);
	expect(supportsIssueImplementation(107)).toBe(false);
	expect(supportsIssueImplementation(108)).toBe(true);
});

test("a transport failure or a junk launch is a keyed action error, never a launch", async () => {
	const failing = callSpy({
		startImplementation: async () => {
			throw new Error("400 RANGE_INVALID glpat-secret");
		},
	});
	const forwarded: IssueSessionLaunch[] = [];
	expect(
		await runIssueAction("implement", failing.call, (launch) => forwarded.push(launch)),
	).toEqual({ ok: false, error: "action" });
	expect(forwarded).toEqual([]);
	expect(String(ISSUE_ERROR_KEY.action)).not.toContain("glpat");
	const junk = callSpy({ launchDesign: async () => ({ workspaceId: "", sessionId: "s1" }) });
	expect(await runIssueAction("design", junk.call, (launch) => forwarded.push(launch))).toEqual({
		ok: false,
		error: "action",
	});
	expect(forwarded).toEqual([]);
});

test("the action call set carries exactly the design launch and the v108 start", async () => {
	const target = { projectId: "p", reference: summary.reference };
	const sent: string[] = [];
	const call = issueActionCall(target, (method) => {
		sent.push(method);
		return Promise.resolve({ workspaceId: "w", sessionId: "s" } as never);
	});
	expect(Object.keys(call).sort()).toEqual(["launchDesign", "startImplementation"]);
	await call.launchDesign();
	await call.startImplementation();
	expect(sent).toEqual(["issues.launchDesign", "issues.startImplementation"]);
	// The click-time approved-design read is gone: nothing here asks the host for a digest.
	expect(JSON.stringify(sent)).not.toContain("designApproval");
});

test("an untrusted project disables every stage action with the trust reason", () => {
	const untrusted = { ...capable, trusted: false };
	for (const stage of ["backlog", "in-progress", "in-review"] as const) {
		const rows = issueActions({ stage }, untrusted);
		expect(rows.map((row) => row.reason)).toEqual(["needs-trust", "needs-trust"]);
	}
	expect(issueActions({ stage: "closed" }, untrusted)).toEqual([]);
	// A host that is also too old still names the older-host reason first.
	expect(
		issueActions({ stage: "backlog" }, { ...untrusted, actionsSupported: false })[0]?.reason,
	).toBe("needs-newer-host");
});

test("an old host keeps design but disables implementation with the newer-host reason", () => {
	const older = { ...capable, implementationSupported: false };
	expect(issueActions({ stage: "in-progress" }, older)).toEqual([
		{ action: "design", reason: null, done: true },
		{ action: "implement", reason: "needs-newer-host", done: false },
	]);
	const html = renderIssues({
		connection: connected,
		issues: [inProgress],
		capabilities: older,
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	expect(html).not.toMatch(/data-testid="issue-action-design"[^>]*data-reason/);
	expect(html).toMatch(/data-testid="issue-action-implement"[^>]*data-reason="needs-newer-host"/);
});

test("an action failure shows beside the row that raised it", () => {
	const withError = renderIssues({
		connection: connected,
		issues: [inProgress],
		actionError: "action",
		actionErrorIssue: issueKey(inProgress),
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	expect(withError).toContain('data-testid="issue-action-error"');
	expect(withError).toContain(text("issues.error.action"));

	const otherRow = renderIssues({
		connection: connected,
		issues: [inProgress],
		actionError: "action",
		actionErrorIssue: "https://gitlab.com/9/9",
		onRunAction: async () => ({ ok: true, launch: { workspaceId: "w1", sessionId: "s1" } }),
	});
	expect(otherRow).not.toContain('data-testid="issue-action-error"');
});
