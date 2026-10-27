import { afterEach, beforeEach, expect, test } from "bun:test";
import { useAppStore } from "./appStore";
import { selectLoginBusy } from "./selectors";

const reset = () =>
	useAppStore.setState({ activeLogin: null, loginStarting: false, removedWorkspaceIds: {} });
beforeEach(reset);
afterEach(reset);
const state = () => useAppStore.getState();

test("all login callers share a synchronous reservation before their requests start", () => {
	expect(state().reserveLogin()).toBe(true);
	expect(selectLoginBusy(state())).toBe(true);
	expect(state().reserveLogin()).toBe(false);
	state().beginLogin("mcp-1", "mcp:docs", { kind: "mcp", workspaceId: "w", serverName: "docs" });
	expect(state().loginStarting).toBe(true);
	state().finishLoginStart();
	expect(state().loginStarting).toBe(false);
	expect(state().reserveLogin()).toBe(false);
	state().clearLogin();
	expect(state().reserveLogin()).toBe(true);
});

test("a failed startup releases the reservation for a later provider or MCP attempt", () => {
	expect(state().reserveLogin()).toBe(true);
	state().finishLoginStart();
	expect(selectLoginBusy(state())).toBe(false);
	expect(state().reserveLogin()).toBe(true);
	state().beginLogin("provider-1", "anthropic");
	expect(state().activeLogin?.providerId).toBe("anthropic");
});

test("frames arriving before the start response keep their content and target", () => {
	const target = { kind: "mcp" as const, workspaceId: "w", serverName: "docs" };
	state().reserveLogin();
	state().applyLoginFrame({
		loginId: "mcp-1",
		providerId: "mcp:docs",
		target,
		frame: { kind: "authUrl", url: "https://example.test/sign-in" },
	});
	state().beginLogin("mcp-1", "mcp:docs", target);
	state().finishLoginStart();
	expect(state().activeLogin).toMatchObject({
		loginId: "mcp-1",
		target,
		url: "https://example.test/sign-in",
	});
	expect(state().reserveLogin()).toBe(false);
});

test("removed workspaces retire their login and cannot recreate it with late frames or responses", () => {
	const target = {
		kind: "mcp" as const,
		workspaceId: "removed-login-workspace",
		serverName: "docs",
	};
	state().beginLogin("mcp-1", "mcp:docs", target);
	state().applyWorkspaceRemoved("p", target.workspaceId);
	expect(state().activeLogin).toBeNull();
	state().applyLoginFrame({
		loginId: "mcp-1",
		providerId: "mcp:docs",
		target,
		frame: { kind: "error", message: "cancelled" },
	});
	state().beginLogin("mcp-1", "mcp:docs", target);
	expect(state().activeLogin).toBeNull();
	expect(state().reserveLogin()).toBe(true);
	state().beginLogin("mcp-1", "mcp:docs", target);
	expect(state().loginStarting).toBe(true);
	state().beginLogin("provider-2", "anthropic");
	state().finishLoginStart();
	expect(state().activeLogin?.loginId).toBe("provider-2");
});

test("a target removed during startup never opens a dialog or releases another startup", () => {
	const target = {
		kind: "mcp" as const,
		workspaceId: "pending-login-workspace",
		serverName: "docs",
	};
	state().reserveLogin();
	state().applyWorkspaceRemoved("p", target.workspaceId);
	state().beginLogin("mcp-late", "mcp:docs", target);
	expect(state().activeLogin).toBeNull();
	expect(state().reserveLogin()).toBe(false);
	state().finishLoginStart();
	expect(state().reserveLogin()).toBe(true);
	state().applyLoginFrame({
		loginId: "mcp-late",
		providerId: "mcp:docs",
		target,
		frame: { kind: "authUrl", url: "https://example.test/auth" },
	});
	expect(state().activeLogin).toBeNull();
	expect(state().loginStarting).toBe(true);
});

test("another login's success invalidates provider status even while this client's own dialog keeps the slot", () => {
	state().beginLogin("provider-1", "anthropic");
	const version = state().providerStatusVersion;
	state().applyLoginFrame({
		loginId: "provider-2",
		providerId: "openai",
		frame: { kind: "success" },
	});
	expect(state().activeLogin).toMatchObject({ loginId: "provider-1", status: "active" });
	expect(state().providerStatusVersion).toBe(version + 1);

	state().applyLoginFrame({
		loginId: "mcp-1",
		providerId: "mcp:docs",
		target: { kind: "mcp", workspaceId: "w", serverName: "docs" },
		frame: { kind: "success" },
	});
	state().applyLoginFrame({
		loginId: "provider-3",
		providerId: "openai",
		frame: { kind: "progress", message: "Waiting" },
	});
	expect(state().providerStatusVersion).toBe(version + 1);
});

test("a late start response never replaces another active modal", () => {
	state().beginLogin("provider-1", "anthropic");
	state().beginLogin("mcp-2", "mcp:docs", { kind: "mcp", workspaceId: "w", serverName: "docs" });
	expect(state().activeLogin?.loginId).toBe("provider-1");
});
