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
				access: "write" as const,
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
		routes: () => null,
		issueLink: () => ({ link: "thinkrail://pair?v=1", expiresAt: 5 }),
		revokeDevice: (id) => {
			state = { ...state, devices: state.devices.filter((d) => d.id !== id) };
			return state;
		},
		renameDevice: (id, label) => {
			state = { ...state, devices: state.devices.map((d) => (d.id === id ? { ...d, label } : d)) };
			return state;
		},
		setDeviceAccess: (id, access) => {
			state = { ...state, devices: state.devices.map((d) => (d.id === id ? { ...d, access } : d)) };
			return state;
		},
		mayRequest: () => "allowed",
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
		"remote.renameDevice",
		"remote.setDeviceAccess",
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
		devices: [{ id: "d1", label: "Phone", pairedAt: 7, access: "write", connected: true }],
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
	expect(
		await handleRequest("remote.renameDevice", { id: "d1", label: "  Olga's iPhone  " }, ctx),
	).toMatchObject({ devices: [{ label: "Olga's iPhone" }] });
	await expect(
		handleRequest("remote.renameDevice", { id: "d1", label: " " }, ctx),
	).rejects.toMatchObject({ code: "REMOTE_DEVICE_LABEL_EMPTY" });
	expect(
		await handleRequest("remote.setDeviceAccess", { id: "d1", access: "read" }, ctx),
	).toMatchObject({ devices: [{ access: "read" }] });
	await expect(
		handleRequest("remote.setDeviceAccess", { id: "d1", access: "admin" }, ctx),
	).rejects.toMatchObject({ code: "REMOTE_DEVICE_ACCESS_INVALID" });
	expect(await handleRequest("remote.revokeDevice", { id: "d1" }, ctx)).toMatchObject({
		devices: [],
	});
});
