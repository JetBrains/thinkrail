import { expect, spyOn, test } from "bun:test";
import {
	ISSUES_APPROVAL_PROTOCOL_VERSION,
	ISSUES_AUTH_PROTOCOL_VERSION,
	ISSUES_DESIGN_APPROVAL_PROTOCOL_VERSION,
	ISSUES_IMPLEMENTATION_PROTOCOL_VERSION,
	ISSUES_PROTOCOL_VERSION,
	type WsParams,
	type WsResult,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { handleRequest } from "./handlers";
import * as issues from "./issues";

/** Methods the v105 Issues auth capability carries: a durable association and its hint. */
function authFloored(method: string): boolean {
	return method === "issues.connect" || method === "issues.repositoryAddress";
}

test("Issue dispatch rejects old protocols before delegation and permits current and in-process callers", async () => {
	const connection = {
		projectId: "local-project",
		instanceUrl: "https://gitlab.example",
		remoteProjectId: "42",
		connected: true,
	};
	const params = { projectId: connection.projectId };
	const connectParams = {
		...params,
		input: {
			instanceUrl: connection.instanceUrl,
			projectId: "group/repo",
			token: "private-protocol-test-token",
		},
	};
	const list = { issues: [], fetchedAt: "2026-11-04T00:00:00Z" };
	const repositoryAddress = { repositoryUrl: "https://gitlab.com/group/repo.git" };
	const calls = [
		{
			method: "issues.connection",
			params,
			result: connection,
			spy: spyOn(issues, "issuesConnection").mockResolvedValue(connection),
		},
		{
			method: "issues.connect",
			params: connectParams,
			result: connection,
			spy: spyOn(issues, "issuesConnect").mockResolvedValue(connection),
		},
		{
			method: "issues.disconnect",
			params,
			result: { ok: true },
			spy: spyOn(issues, "issuesDisconnect").mockResolvedValue({ ok: true }),
		},
		{
			method: "issues.list",
			params,
			result: list,
			spy: spyOn(issues, "issuesList").mockResolvedValue(list),
		},
		{
			method: "issues.repositoryAddress",
			params,
			result: repositoryAddress,
			spy: spyOn(issues, "issuesRepositoryAddress").mockResolvedValue(repositoryAddress),
		},
	];
	try {
		for (const call of calls) {
			const error = await handleRequest(call.method, call.params, {
				clientKey: "issues-protocol-test",
				protocolVersion: 102,
			}).then(
				() => null,
				(error: unknown) => error,
			);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
			expect((error as Error).message).toBe(
				authFloored(call.method)
					? "Issue associations are unavailable for this protocol version."
					: "Issues are unavailable for this protocol version.",
			);
			expect((error as Error).cause).toBeUndefined();
			expect(String(error)).not.toContain(connectParams.input.token);
		}
		for (const call of calls) expect(call.spy).not.toHaveBeenCalled();

		// Reads keep their v103 floor; connect and the address hint need the v105 auth capability.
		for (const call of calls) {
			const accepted = authFloored(call.method)
				? [ISSUES_AUTH_PROTOCOL_VERSION, ISSUES_AUTH_PROTOCOL_VERSION + 1, undefined]
				: [
						ISSUES_PROTOCOL_VERSION,
						ISSUES_PROTOCOL_VERSION + 1,
						ISSUES_AUTH_PROTOCOL_VERSION,
						undefined,
					];
			for (const protocolVersion of accepted) {
				expect(
					await handleRequest(call.method, call.params, {
						clientKey: "issues-protocol-test",
						...(protocolVersion === undefined ? {} : { protocolVersion }),
					}),
				).toEqual(call.result);
				expect(call.spy).toHaveBeenLastCalledWith(call.params);
			}
			expect(call.spy).toHaveBeenCalledTimes(accepted.length);
		}
	} finally {
		for (const call of calls) call.spy.mockRestore();
	}
});

test("the v105 repository-address hint rejects old protocols and unknown keys statically", async () => {
	for (const protocolVersion of [103, 104]) {
		const error = await handleRequest(
			"issues.repositoryAddress",
			{ projectId: "local-project" },
			{ clientKey: "issues-address-test", protocolVersion },
		).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(CodedError);
		expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
		expect((error as Error).message).toBe(
			"Issue associations are unavailable for this protocol version.",
		);
	}
	// The host never accepts a caller path or token for this read, and echoes neither.
	for (const params of [
		{ projectId: "local-project", path: "/tmp/repo" },
		{ projectId: "local-project", token: "private-address-PAT" },
		{ path: "/tmp/repo" },
	]) {
		const error = await handleRequest("issues.repositoryAddress", params, {
			clientKey: "issues-address-test",
			protocolVersion: 105,
		}).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(CodedError);
		expect((error as CodedError).code).toBe("RANGE_INVALID");
		expect((error as Error).cause).toBeUndefined();
		expect(String(error)).not.toContain("private-address-PAT");
		expect(String(error)).not.toContain("/tmp/repo");
	}
});

const actionTarget = {
	projectId: "local-project",
	reference: {
		provider: "gitlab" as const,
		instanceUrl: "https://gitlab.example",
		projectId: "42",
		number: 7,
	},
};
const implementationTarget = { ...actionTarget, approvedDesignVersion: `design:${"a".repeat(64)}` };
const publication = {
	stage: "design" as const,
	version: `design:${"b".repeat(64)}`,
	noteId: 1,
	resetEventId: 0,
	body: "publication",
};
function actionCase<
	M extends
		| "issues.launchDesign"
		| "issues.launchImplementation"
		| "issues.publishDesign"
		| "issues.publishImplementation"
		| "issues.validateDesign"
		| "issues.validateImplementation",
>(method: M, params: WsParams<M>, result: WsResult<M>) {
	return { method, params, result };
}
const actionCalls = [
	{
		...actionCase("issues.launchDesign", actionTarget, {
			workspaceId: "workspace",
			sessionId: "session",
		}),
		name: "issuesLaunchDesign" as const,
	},
	{
		...actionCase("issues.launchImplementation", implementationTarget, {
			workspaceId: "workspace",
			sessionId: "session",
		}),
		name: "issuesLaunchImplementation" as const,
	},
	{
		...actionCase(
			"issues.publishDesign",
			{ ...actionTarget, expectedDescription: "old", newDescription: "new" },
			publication,
		),
		name: "issuesPublishDesign" as const,
	},
	{
		...actionCase("issues.publishImplementation", implementationTarget, {
			...publication,
			stage: "implementation",
			version: `implementation:${"b".repeat(64)}`,
		}),
		name: "issuesPublishImplementation" as const,
	},
	{
		...actionCase("issues.validateDesign", actionTarget, { approved: true, eventId: 2, userId: 3 }),
		name: "issuesValidateDesign" as const,
	},
	{
		...actionCase("issues.validateImplementation", actionTarget, {
			approved: false,
			reason: "unproven",
		}),
		name: "issuesValidateImplementation" as const,
	},
];

test("all six Issue actions reject old protocols before delegation with a static credential-safe error", async () => {
	for (const call of actionCalls) {
		for (const protocolVersion of [102, 103]) {
			const error = await handleRequest(
				call.method,
				{ token: "private-action-PAT" },
				{ clientKey: "issues-actions-test", protocolVersion },
			).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
			expect((error as Error).message).toBe(
				"Issue actions are unavailable for this protocol version.",
			);
			expect((error as Error).cause).toBeUndefined();
			expect(String(error)).not.toContain("private-action-PAT");
		}
	}
});

test("six typed Issue requests forward unchanged at v104, newer and in-process only", async () => {
	for (const call of actionCalls) {
		const spy = spyOn(issues, call.name).mockResolvedValue(call.result);
		try {
			await expect(
				handleRequest(call.method, call.params, {
					clientKey: "issues-actions-test",
					protocolVersion: 103,
				}),
			).rejects.toThrow("Issue actions are unavailable for this protocol version.");
			expect(spy).not.toHaveBeenCalled();
			for (const protocolVersion of [104, 105, undefined]) {
				const result = await handleRequest(call.method, call.params, {
					clientKey: "issues-actions-test",
					...(protocolVersion === undefined ? {} : { protocolVersion }),
				});
				expect(result).toEqual(call.result);
				expect(JSON.stringify(result)).not.toContain("private-action-PAT");
				expect(spy).toHaveBeenLastCalledWith(call.params);
			}
			expect(spy).toHaveBeenCalledTimes(3);
		} finally {
			spy.mockRestore();
		}
	}
});

test("v104 action dispatch retains host unknown-input validation without echoing raw PAT", async () => {
	for (const call of actionCalls) {
		const error = await handleRequest(
			call.method,
			{ ...call.params, token: "private-action-PAT" },
			{ clientKey: "issues-actions-test", protocolVersion: 104 },
		).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(CodedError);
		expect((error as CodedError).code).toBe("RANGE_INVALID");
		expect((error as Error).cause).toBeUndefined();
		expect(String(error)).not.toContain("private-action-PAT");
	}
});

test("v106 approvals reject older protocols and unknown keys before any side effect", async () => {
	expect(ISSUES_APPROVAL_PROTOCOL_VERSION).toBe(106);
	const approval = { approved: false, reason: "unproven" } as const;
	for (const call of [
		{ method: "issues.approveDesign" as const, name: "issuesApproveDesign" as const },
		{
			method: "issues.approveImplementation" as const,
			name: "issuesApproveImplementation" as const,
		},
	]) {
		for (const protocolVersion of [102, 104, 105]) {
			const error = await handleRequest(call.method, actionTarget, {
				clientKey: "issues-approval-test",
				protocolVersion,
			}).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
			expect((error as Error).message).toBe(
				"Issue approvals are unavailable for this protocol version.",
			);
			expect((error as Error).cause).toBeUndefined();
		}
		const spy = spyOn(issues, call.name).mockResolvedValue(approval);
		try {
			for (const protocolVersion of [106, 107, undefined]) {
				expect(
					await handleRequest(call.method, actionTarget, {
						clientKey: "issues-approval-test",
						...(protocolVersion === undefined ? {} : { protocolVersion }),
					}),
				).toEqual(approval);
				expect(spy).toHaveBeenLastCalledWith(actionTarget);
			}
			expect(spy).toHaveBeenCalledTimes(3);
		} finally {
			spy.mockRestore();
		}
		// The host action itself still rejects caller-supplied actors, versions and credentials.
		for (const params of [
			{ ...actionTarget, userId: 3 },
			{ ...actionTarget, version: `design:${"b".repeat(64)}` },
			{ ...implementationTarget },
			{ ...actionTarget, token: "private-approval-PAT" },
		]) {
			const error = await handleRequest(call.method, params, {
				clientKey: "issues-approval-test",
				protocolVersion: 106,
			}).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RANGE_INVALID");
			expect((error as Error).cause).toBeUndefined();
			expect(String(error)).not.toContain("private-approval-PAT");
		}
	}
});

test("the v107 design-approval read rejects older protocols before delegation", async () => {
	expect(ISSUES_DESIGN_APPROVAL_PROTOCOL_VERSION).toBe(107);
	const result = { approvedDesignVersion: `design:${"e".repeat(64)}` };
	const spy = spyOn(issues, "issuesDesignApproval").mockResolvedValue(result);
	try {
		for (const protocolVersion of [102, 104, 105, 106]) {
			const error = await handleRequest("issues.designApproval", actionTarget, {
				clientKey: "issues-design-approval-test",
				protocolVersion,
			}).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
			expect((error as Error).message).toBe(
				"Issue design approvals are unavailable for this protocol version.",
			);
			expect((error as Error).cause).toBeUndefined();
		}
		expect(spy).not.toHaveBeenCalled();
		// v107 and in-process callers are delegated with the advertised protocol.
		for (const protocolVersion of [107, 108, undefined]) {
			expect(
				await handleRequest("issues.designApproval", actionTarget, {
					clientKey: "issues-design-approval-test",
					...(protocolVersion === undefined ? {} : { protocolVersion }),
				}),
			).toEqual(result);
			expect(spy).toHaveBeenLastCalledWith(actionTarget, protocolVersion);
		}
		expect(spy).toHaveBeenCalledTimes(3);
	} finally {
		spy.mockRestore();
	}
});

test("the v107 design-approval read keeps host unknown-key validation without echoing a PAT", async () => {
	for (const params of [
		{ ...actionTarget, approvedDesignVersion: `design:${"f".repeat(64)}` },
		{ ...actionTarget, token: "private-design-PAT" },
		{ ...actionTarget, path: "/tmp/elsewhere" },
	]) {
		const error = await handleRequest("issues.designApproval", params, {
			clientKey: "issues-design-approval-test",
			protocolVersion: 107,
		}).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(CodedError);
		expect((error as CodedError).code).toBe("RANGE_INVALID");
		expect((error as Error).cause).toBeUndefined();
		expect(String(error)).not.toContain("private-design-PAT");
		expect(String(error)).not.toContain("/tmp/elsewhere");
	}
});

test("the v108 implementation start rejects older protocols and forwards the shared target", async () => {
	expect(ISSUES_IMPLEMENTATION_PROTOCOL_VERSION).toBe(108);
	const result = { workspaceId: "workspace", sessionId: "session" };
	const spy = spyOn(issues, "issuesStartImplementation").mockResolvedValue(result);
	try {
		for (const protocolVersion of [102, 104, 105, 106, 107]) {
			const error = await handleRequest("issues.startImplementation", actionTarget, {
				clientKey: "issues-implementation-test",
				protocolVersion,
			}).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RESOURCE_UNAVAILABLE");
			expect((error as Error).message).toBe(
				"Issue implementation starts are unavailable for this protocol version.",
			);
			expect((error as Error).cause).toBeUndefined();
		}
		expect(spy).not.toHaveBeenCalled();
		// v108 and in-process callers reach the host action with exactly the shared target.
		for (const protocolVersion of [108, 109, undefined]) {
			expect(
				await handleRequest("issues.startImplementation", actionTarget, {
					clientKey: "issues-implementation-test",
					...(protocolVersion === undefined ? {} : { protocolVersion }),
				}),
			).toEqual(result);
			expect(spy).toHaveBeenLastCalledWith(actionTarget);
		}
		expect(spy).toHaveBeenCalledTimes(3);
	} finally {
		spy.mockRestore();
	}
	// The start gate takes no caller version, path or credential.
	for (const params of [
		{ ...actionTarget, approvedDesignVersion: `design:${"a".repeat(64)}` },
		{ ...actionTarget, token: "private-start-PAT" },
		{ ...actionTarget, reference: { ...actionTarget.reference, path: "/tmp/elsewhere" } },
	]) {
		const error = await handleRequest("issues.startImplementation", params, {
			clientKey: "issues-implementation-test",
			protocolVersion: 108,
		}).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(CodedError);
		expect((error as CodedError).code).toBe("RANGE_INVALID");
		expect((error as Error).cause).toBeUndefined();
		expect(String(error)).not.toContain("private-start-PAT");
		expect(String(error)).not.toContain("/tmp/elsewhere");
	}
});

test("v109 begin methods gate old clients before delegation and preserve request locale", async () => {
	for (const call of [
		{ method: "issues.beginDesign", name: "issuesBeginDesign" },
		{ method: "issues.beginImplementation", name: "issuesBeginImplementation" },
	] as const) {
		const result = { workspaceId: "workspace", sessionId: "session" };
		const params = { ...actionTarget, locale: "zh-CN" };
		const spy = spyOn(issues, call.name).mockResolvedValue(result);
		try {
			for (const protocolVersion of [104, 108])
				await expect(
					handleRequest(call.method, params, { clientKey: "begin", protocolVersion }),
				).rejects.toThrow("Issue session startup is unavailable for this protocol version.");
			expect(spy).not.toHaveBeenCalled();
			for (const protocolVersion of [109, 110, undefined]) {
				expect(
					await handleRequest(call.method, params, {
						clientKey: "begin",
						...(protocolVersion === undefined ? {} : { protocolVersion }),
					}),
				).toEqual(result);
				expect(spy).toHaveBeenLastCalledWith(params);
			}
		} finally {
			spy.mockRestore();
		}
		for (const params of [
			actionTarget,
			{ ...actionTarget, locale: "system" },
			{ ...actionTarget, locale: "en", token: "private-PAT" },
		]) {
			const error = await handleRequest(call.method, params, {
				clientKey: "begin",
				protocolVersion: 109,
			}).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(CodedError);
			expect((error as CodedError).code).toBe("RANGE_INVALID");
			expect(String(error)).not.toContain("private-PAT");
		}
	}
});
