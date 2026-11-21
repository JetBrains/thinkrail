import { expect, test } from "bun:test";
import { t } from "@thinkrail/locales/react";
import { RemoteConnectError, type RemoteConnection } from "@thinkrail/remote-client";
import { useAppStore } from "../store";
import { connectFailureText } from "./connectFailure";
import { createRemoteConnectionController, reportRemoteHostLost } from "./remoteConnection";

const LINK = "thinkrail://pair?v=1&s=ws://relay:1&t=tok&k=KEY&p=proj";

function connection(): RemoteConnection {
	return {
		client: {
			attach: () => {},
			detach: () => {},
			open: true,
			onOpenChange: () => () => {},
			request: () => Promise.reject(new Error("not used")),
			subscribe: () => () => {},
			close: () => {},
		},
		hostKey: "KEY",
		relayUrl: "ws://relay:1",
		relayUrls: ["ws://relay:1"],
		nostr: undefined,
		reconnectNow: () => {},
		close: () => {},
	};
}

test("rejects an invalid link without calling the connector", async () => {
	let called = false;
	const controller = createRemoteConnectionController(async () => {
		called = true;
		return connection();
	});
	await controller.connect("not a link", "Phone");
	expect(controller.getState()).toEqual({ status: "error", kind: "invalid-link" });
	expect(called).toBe(false);
});

test("transitions idle → connecting → connected and notifies subscribers", async () => {
	const states: string[] = [];
	const controller = createRemoteConnectionController(async () => connection());
	controller.subscribe(() => states.push(controller.getState().status));
	await controller.connect(LINK, "Phone");
	expect(states).toEqual(["connecting", "connected"]);
	const state = controller.getState();
	expect(state.status === "connected" && state.connection.hostKey).toBe("KEY");
});

test("surfaces a connector failure as an error state", async () => {
	const controller = createRemoteConnectionController(async () => {
		throw new Error("relay connection failed");
	});
	await controller.connect(LINK, "Phone");
	expect(controller.getState()).toEqual({
		status: "error",
		kind: "failed",
		failure: { kind: "error", message: "relay connection failed" },
	});
	controller.reset();
	expect(controller.getState()).toEqual({ status: "idle" });
});

function deferred() {
	let resolve: (value: RemoteConnection) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<RemoteConnection>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function closable() {
	const state = { closed: false };
	const close = (): void => {
		state.closed = true;
	};
	return { connection: { ...connection(), close }, state };
}

test("a connect that lands after reset is closed and does not overwrite idle", async () => {
	const pending = deferred();
	const controller = createRemoteConnectionController(() => pending.promise);
	const connecting = controller.connect(LINK, "Phone");
	controller.reset();
	const late = closable();
	pending.resolve(late.connection);
	await connecting;
	expect(controller.getState()).toEqual({ status: "idle" });
	expect(late.state.closed).toBe(true);
});

test("a failure that lands after reset does not overwrite idle", async () => {
	const pending = deferred();
	const controller = createRemoteConnectionController(() => pending.promise);
	const connecting = controller.connect(LINK, "Phone");
	controller.reset();
	pending.reject(new Error("timed out"));
	await connecting;
	expect(controller.getState()).toEqual({ status: "idle" });
});

test("only the newest connect wins; an older one finishing later is closed", async () => {
	const attempts = [deferred(), deferred()];
	let call = 0;
	const controller = createRemoteConnectionController(
		() => attempts[call++]?.promise ?? Promise.reject(new Error("unexpected")),
	);
	const first = controller.connect(LINK, "Phone");
	const second = controller.connect(LINK, "Phone");
	const newer = closable();
	const older = closable();
	attempts[1]?.resolve(newer.connection);
	await second;
	attempts[0]?.resolve(older.connection);
	await first;
	const state = controller.getState();
	expect(state.status === "connected" && state.connection).toBe(newer.connection);
	expect(older.state.closed).toBe(true);
	expect(newer.state.closed).toBe(false);
});

test("a failure keeps its code, and its text is the localized reason, never the raw detail", async () => {
	const controller = createRemoteConnectionController(async () => {
		throw new RemoteConnectError("code_expired", "expired at ws://10.0.0.2:7777");
	});
	await controller.connect(LINK, "Phone");
	const state = controller.getState();
	if (state.status !== "error" || state.kind !== "failed") throw new Error("expected a failure");
	expect(state.failure).toMatchObject({ kind: "remote", code: "code_expired" });
	expect(connectFailureText(t, state.failure)).toBe(t("panels.connectByLink.errors.codeExpired"));
	const raw = { kind: "remote", code: "rejected", message: "denied by 10.0.0.2" } as const;
	expect(connectFailureText(t, raw)).toBe(t("panels.connectByLink.errors.failed"));
	expect(connectFailureText(t, { kind: "network" })).toBe(t("panels.connectByLink.errors.network"));
});

test("a connection lost later is reported with the link's host key", async () => {
	const lost: [string, string][] = [];
	let loseIt: (error: RemoteConnectError) => void = () => {};
	const controller = createRemoteConnectionController(
		async (_link, options) => {
			loseIt = options.onLost;
			return connection();
		},
		(hostKey, error) => lost.push([hostKey, error.code]),
	);
	await controller.connect(LINK, "Phone");
	loseIt(new RemoteConnectError("unknown_device", "revoked"));
	expect(lost).toEqual([["KEY", "unknown_device"]]);
});

test("losing the mounted remote host reads disconnected with a toast back to this computer", () => {
	useAppStore.getState().resetHostState();
	useAppStore.getState().enterRemoteHost("KEY", true);
	const toasts = useAppStore.getState().toasts.length;
	reportRemoteHostLost("OTHER", new RemoteConnectError("unknown_device", "revoked"));
	expect(useAppStore.getState().status).toBe("connected");
	expect(useAppStore.getState().toasts).toHaveLength(toasts);

	reportRemoteHostLost("KEY", new RemoteConnectError("unknown_device", "revoked"));
	expect(useAppStore.getState().status).toBe("disconnected");
	const toast = useAppStore.getState().toasts.at(-1);
	expect(toast?.message).toBe(t("panels.connectByLink.errors.unknownDevice"));
	expect(toast?.action?.label).toBe(t("panels.connectByLink.lost.backToLocal"));
});
