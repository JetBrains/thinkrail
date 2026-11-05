import { expect, test } from "bun:test";
import type { RemoteAccessControl, RemoteAccessState } from "../remote-transport";
import { handleRequest } from "./handlers";

function fakeControl() {
	let state: RemoteAccessState = {
		enabled: false,
		addresses: [],
		devices: [
			{
				id: "d1",
				label: "Phone",
				publicKey: "SECRET-KEY",
				pairedAt: 7,
				lastSeenAt: 9,
				connected: true,
			},
		],
	};
	const control: RemoteAccessControl = {
		state: () => state,
		setEnabled: (enabled) => {
			state = {
				...state,
				enabled,
				addresses: enabled ? [{ url: "ws://192.168.0.2:1", route: "lan" }] : [],
				...(enabled
					? { relay: { kind: "builtIn", port: 1, publicCheck: { state: "offline" } } as const }
					: {}),
			};
			return state;
		},
		issueLink: () => ({ link: "thinkrail://pair?v=1", expiresAt: 5 }),
		revokeDevice: (id) => {
			state = { ...state, devices: state.devices.filter((d) => d.id !== id) };
			return state;
		},
		restore: () => state,
		ready: () => Promise.resolve(),
		stop: () => {},
	};
	return control;
}

test("a paired phone cannot manage phone access", async () => {
	for (const method of [
		"remote.status",
		"remote.setEnabled",
		"remote.issueLink",
		"remote.revokeDevice",
	]) {
		await expect(
			handleRequest(method, { enabled: true, id: "d1" }, { clientKey: "remote:d1" }),
		).rejects.toMatchObject({
			code: "REMOTE_ACCESS_LOCAL_ONLY",
		});
	}
});

test("this computer's client switches access, mints codes only while on, and never sees device keys", async () => {
	const ctx = { clientKey: "local", remoteAccess: fakeControl() };
	expect(await handleRequest("remote.status", {}, ctx)).toEqual({
		enabled: false,
		addresses: [],
		devices: [{ id: "d1", label: "Phone", pairedAt: 7, connected: true }],
	});
	await expect(handleRequest("remote.issueLink", {}, ctx)).rejects.toMatchObject({
		code: "REMOTE_ACCESS_OFF",
	});
	expect(await handleRequest("remote.setEnabled", { enabled: true }, ctx)).toMatchObject({
		enabled: true,
		relay: { kind: "builtIn", port: 1, publicCheck: { state: "offline" } },
	});
	expect(await handleRequest("remote.issueLink", {}, ctx)).toEqual({
		link: "thinkrail://pair?v=1",
		expiresAt: 5,
	});
	expect(await handleRequest("remote.revokeDevice", { id: "d1" }, ctx)).toMatchObject({
		devices: [],
	});
});
