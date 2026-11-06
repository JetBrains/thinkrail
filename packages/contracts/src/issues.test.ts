import { expect, test } from "bun:test";
import {
	canonicalIssueInstanceUrl,
	hasIssueHttpConsent,
	isIssueApprovalResult,
	isIssueConnectionInput,
	isIssueDesignApproval,
	isIssueDesignPublicationInput,
	isIssueImplementationTarget,
	isIssuePublication,
	isIssueReference,
	isIssueSessionLaunch,
	isIssueTarget,
	requiresIssueHttpConsent,
} from "./index";

test("accepts a credential-free provider-qualified Issue reference", () => {
	expect(
		isIssueReference({
			provider: "gitlab",
			instanceUrl: "https://gitlab.example.com",
			projectId: "17",
			number: 42,
		}),
	).toBe(true);
});

test("rejects ambiguous or credential-bearing Issue identities", () => {
	for (const reference of [
		null,
		{},
		{
			provider: "gitlab",
			instanceUrl: "https://user:secret@gitlab.example.com",
			projectId: "17",
			number: 42,
		},
		{
			provider: "gitlab",
			instanceUrl: "https://gitlab.example.com?token=secret",
			projectId: "17",
			number: 42,
		},
		{ provider: "gitlab", instanceUrl: "https://gitlab.example.com", projectId: "17", number: -1 },
	]) {
		expect(isIssueReference(reference)).toBe(false);
	}
});

test("connection input permits HTTP(S), and requires a project and a nonblank token", () => {
	expect(
		isIssueConnectionInput({
			instanceUrl: "https://gitlab.example.com/gitlab",
			projectId: "group/repo",
			token: "secret",
		}),
	).toBe(true);
	for (const input of [
		null,
		{ instanceUrl: "https://gitlab.example.com", projectId: "", token: "secret" },
		{ instanceUrl: "https://gitlab.example.com", projectId: "17", token: " " },
		{ instanceUrl: "https://gitlab.example.com", projectId: "17", token: "secret\r\ninjected" },
		{ instanceUrl: "https://gitlab.example.com", projectId: "../repo", token: "secret" },
	]) {
		expect(isIssueConnectionInput(input)).toBe(false);
	}
});

// These contracts declare capabilities only; no stage-action RPC is registered here.
const target = {
	projectId: "local-project.1",
	reference: {
		provider: "gitlab",
		instanceUrl: "https://gitlab.example.com",
		projectId: "17",
		number: 42,
	},
};
const designVersion = `design:${"a".repeat(64)}`;
const implementationTarget = { ...target, approvedDesignVersion: designVersion };
const designInput = { ...target, expectedDescription: "old", newDescription: "new" };

test("stage action guards are publicly exported and accept the six request shapes", () => {
	expect(isIssueTarget(target)).toBe(true); // launchDesign / validateDesign / validateImplementation
	expect(isIssueImplementationTarget(implementationTarget)).toBe(true); // launchImplementation / publishImplementation
	expect(isIssueDesignPublicationInput(designInput)).toBe(true);
	expect(
		isIssueTarget({
			...target,
			reference: { ...target.reference, instanceUrl: "https://gitlab.example.com/gitlab" },
		}),
	).toBe(true);
});

test("action guards reject extra own keys, including nested credentials and caller authority", () => {
	for (const [guard, input] of [
		[isIssueTarget, target],
		[isIssueImplementationTarget, implementationTarget],
		[isIssueDesignPublicationInput, designInput],
	] as const) {
		for (const extra of [
			{ token: "secret" },
			{ sha: "a".repeat(40) },
			{ path: "/tmp" },
			{ workspaceId: "ws" },
			{ [Symbol("extra")]: true },
		]) {
			expect(guard({ ...input, ...extra })).toBe(false);
			expect(guard({ ...input, reference: { ...target.reference, ...extra } })).toBe(false);
		}
		for (const value of [
			null,
			[],
			Object.create(input),
			{ ...input, reference: Object.create(target.reference) },
		])
			expect(guard(value)).toBe(false);
		for (const key of Object.keys(input)) {
			const missing: Record<string, unknown> = { ...input };
			delete missing[key];
			expect(guard(missing)).toBe(false);
		}
	}
});

test("action identity is canonical and stricter than legacy reference and connection guards", () => {
	for (const projectId of ["", "../x", " x", "x/y", "x".repeat(257), "_x", "é"])
		expect(isIssueTarget({ ...target, projectId })).toBe(false);
	expect(isIssueTarget({ ...target, projectId: `a${"_".repeat(255)}` })).toBe(true);
	for (const projectId of [
		"group/repo",
		"01",
		"0",
		"-1",
		"1.0",
		"9007199254740992",
		"1".repeat(17),
	])
		expect(isIssueTarget({ ...target, reference: { ...target.reference, projectId } })).toBe(false);
	expect(
		isIssueTarget({
			...target,
			reference: {
				...target.reference,
				projectId: "9007199254740991",
				number: Number.MAX_SAFE_INTEGER,
			},
		}),
	).toBe(true);
	for (const number of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"])
		expect(isIssueTarget({ ...target, reference: { ...target.reference, number } })).toBe(false);
	for (const instanceUrl of [
		"ssh://gitlab.example.com",
		"https://gitlab.example.com/",
		"https://GITLAB.example.com",
		"https://gitlab.example.com:443",
		"https://gitlab.example.com?",
		"https://gitlab.example.com#",
		"https://gitlab.example.com/?x=1",
		"https://user@gitlab.example.com",
		"https://gitlab.example.com/@x",
		" https://gitlab.example.com",
		"https://gitlab.example.com/\tx",
		"https://gitlab.example.com/\\x",
		`https://gitlab.example.com/${"x".repeat(2048)}`,
	])
		expect(isIssueTarget({ ...target, reference: { ...target.reference, instanceUrl } })).toBe(
			false,
		);
	const legacy = {
		...target.reference,
		projectId: "group/repo",
		instanceUrl: "https://GITLAB.example.com/",
		token: "ignored",
	};
	expect(isIssueReference(legacy)).toBe(true);
	expect(
		isIssueConnectionInput({
			instanceUrl: legacy.instanceUrl,
			projectId: legacy.projectId,
			token: "secret",
			extra: true,
		}),
	).toBe(true);
});

test("implementation requires a design digest, never caller commit or workspace data", () => {
	for (const approvedDesignVersion of [
		"",
		"design:abc",
		`design:${"A".repeat(64)}`,
		`implementation:${"a".repeat(64)}`,
		null,
	])
		expect(isIssueImplementationTarget({ ...target, approvedDesignVersion })).toBe(false);
	expect(isIssueImplementationTarget(target)).toBe(false);
});

test("design descriptions are independently bounded by UTF-8 bytes", () => {
	for (const key of ["expectedDescription", "newDescription"]) {
		for (const text of ["", "a".repeat(262144), "😀".repeat(65536), "é".repeat(131072)])
			expect(isIssueDesignPublicationInput({ ...designInput, [key]: text })).toBe(true);
		for (const text of [null, 1, "a".repeat(262145), `${"😀".repeat(65536)}a`, "é".repeat(131073)])
			expect(isIssueDesignPublicationInput({ ...designInput, [key]: text })).toBe(false);
	}
});

test("session, publication and approval results are exact and credential-free", () => {
	expect(isIssueSessionLaunch({ workspaceId: "ws", sessionId: "session" })).toBe(true);
	for (const value of [
		{ workspaceId: "", sessionId: "s" },
		{ workspaceId: "ws", sessionId: "" },
		{ workspaceId: "ws", sessionId: "s", token: "secret" },
	])
		expect(isIssueSessionLaunch(value)).toBe(false);
	const publication = {
		stage: "design",
		version: designVersion,
		noteId: 1,
		resetEventId: 0,
		body: "opaque provider note",
	};
	expect(isIssuePublication(publication)).toBe(true);
	expect(
		isIssuePublication({
			...publication,
			stage: "implementation",
			version: `implementation:${"b".repeat(64)}`,
		}),
	).toBe(true);
	for (const override of [
		{ stage: "other" },
		{ stage: "implementation" },
		{ version: "design:x" },
		{ noteId: 0 },
		{ noteId: 1.5 },
		{ resetEventId: -1 },
		{ resetEventId: Infinity },
		{ body: null },
		{ token: "secret" },
		{ [Symbol("extra")]: 1 },
	])
		expect(isIssuePublication({ ...publication, ...override })).toBe(false);
	expect(isIssueApprovalResult({ approved: true, eventId: 1, userId: 2 })).toBe(true);
	expect(isIssueApprovalResult({ approved: false, reason: "unproven" })).toBe(true);
	for (const value of [
		null,
		{ approved: true, eventId: 0, userId: 2 },
		{ approved: true, eventId: 1, userId: Number.MAX_SAFE_INTEGER + 1 },
		{ approved: true, eventId: 1, userId: 2, reason: "unproven" },
		{ approved: false, reason: "unknown" },
		{ approved: false, reason: "unproven", eventId: 1 },
	])
		expect(isIssueApprovalResult(value)).toBe(false);
});

test("a design approval read is exact and carries only a design digest or null", () => {
	expect(isIssueDesignApproval({ approvedDesignVersion: null })).toBe(true);
	expect(isIssueDesignApproval({ approvedDesignVersion: designVersion })).toBe(true);
	for (const value of [
		null,
		{},
		{ approvedDesignVersion: undefined },
		{ approvedDesignVersion: "" },
		{ approvedDesignVersion: "design:abc" },
		{ approvedDesignVersion: `design:${"A".repeat(64)}` },
		{ approvedDesignVersion: `implementation:${"a".repeat(64)}` },
		{ approvedDesignVersion: designVersion, approved: true },
		{ approvedDesignVersion: designVersion, token: "secret" },
		{ approvedDesignVersion: designVersion, [Symbol("extra")]: 1 },
	])
		expect(isIssueDesignApproval(value)).toBe(false);
});

test("canonical instance URLs normalize root and base paths without accepting URL parser repairs", () => {
	for (const [input, expected] of [
		["HTTPS://GITLAB.example.com:443/", "https://gitlab.example.com"],
		["http://gitlab.example.com/gitlab///", "http://gitlab.example.com/gitlab"],
		["http://[::1]:8080/", "http://[::1]:8080"],
	] as const) {
		expect(canonicalIssueInstanceUrl(input)).toBe(expected);
		expect(canonicalIssueInstanceUrl(expected)).toBe(expected);
	}
	for (const input of [
		null,
		"",
		"ssh://host",
		"https:host",
		"https:///host",
		"https://host?",
		"https://host#",
		"https://host/@x",
		"https://@host",
		"https://user:secret@host",
		"https://host/\\x",
		"https://host/	x",
		" https://host",
		"https://host/",
		`https://host/${"x".repeat(2048)}`,
	]) {
		expect(canonicalIssueInstanceUrl(input)).toBeNull();
		expect(isIssueReference({ ...target.reference, instanceUrl: input })).toBe(false);
	}
	expect(isIssueReference({ ...target.reference, instanceUrl: "http://HOST/base/" })).toBe(true);
	expect(
		isIssueTarget({
			...target,
			reference: { ...target.reference, instanceUrl: "http://host/base" },
		}),
	).toBe(true);
});

test("HTTP consent exemptions are literal loopback only, never LAN or DNS", () => {
	for (const instance of [
		"https://remote.example",
		"http://localhost",
		"http://LOCALHOST:8080/base",
		"http://127.0.0.1",
		"http://127.255.1.2:8080",
		"http://[::1]/base",
	])
		expect(requiresIssueHttpConsent(instance)).toBe(false);
	for (const instance of [
		"http://remote.example",
		"http://localhost.example",
		"http://localhost.",
		"http://10.0.0.1",
		"http://192.168.1.2",
		"http://172.16.0.1",
		"http://[::ffff:127.0.0.1]",
		"http://127.1",
		"http://2130706433",
		"ssh://localhost",
	])
		expect(requiresIssueHttpConsent(instance)).toBe(true);
});

test("connection guard validates optional exact consent shape separately from authorization", () => {
	const input = { instanceUrl: "http://host:8080/base", projectId: "17", token: "secret" };
	expect(isIssueConnectionInput(input)).toBe(true);
	expect(hasIssueHttpConsent(input)).toBe(false);
	const httpConsent = { instanceUrl: input.instanceUrl };
	expect(isIssueConnectionInput({ ...input, httpConsent })).toBe(true);
	expect(hasIssueHttpConsent({ ...input, httpConsent })).toBe(true);
	expect(hasIssueHttpConsent(input, httpConsent)).toBe(true);
	for (const instanceUrl of [
		"http://other:8080/base",
		"http://host:8081/base",
		"http://host:8080/other",
		"https://host:8080/base",
		"http://host:8080/base/",
	]) {
		expect(hasIssueHttpConsent({ ...input, httpConsent: { instanceUrl } })).toBe(false);
		expect(hasIssueHttpConsent(input, { instanceUrl })).toBe(false);
	}
	for (const httpConsent of [
		null,
		undefined,
		{},
		{ instanceUrl: 1 },
		{ instanceUrl: "ssh://host" },
		{ instanceUrl: "http://HOST:8080/base" },
		{ instanceUrl: input.instanceUrl, token: "secret" },
		{ instanceUrl: input.instanceUrl, [Symbol("extra")]: true },
		Object.create({ instanceUrl: input.instanceUrl }),
	]) {
		expect(isIssueConnectionInput({ ...input, httpConsent })).toBe(false);
		expect(isIssueConnectionInput({ ...input, instanceUrl: "https://host", httpConsent })).toBe(
			false,
		);
	}
	expect(hasIssueHttpConsent({ ...input, instanceUrl: "https://host" })).toBe(true);
	expect(hasIssueHttpConsent({ ...input, instanceUrl: "http://localhost" })).toBe(true);
	// Legacy outer objects remain permissive; host request boundaries may enforce exact keys.
	expect(isIssueConnectionInput({ ...input, extra: true })).toBe(true);
});
