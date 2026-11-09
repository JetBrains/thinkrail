import { expect, test } from "bun:test";
import { type Project, WS_CHANNELS } from "@thinkrail/contracts";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import { useAppStore } from "../store";
import { isHostResetting, onHostReset } from "./hostReset";
import { mountRemoteSession } from "./wireTransport";

interface FakeHost {
	client: DeviceWireClient;
	push(channel: string, data: unknown): void;
	subscriberCount(): number;
}

function fakeHost(): FakeHost {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	return {
		client: {
			attach() {},
			request: () => new Promise(() => {}),
			subscribe(channel, handler) {
				let set = handlers.get(channel);
				if (!set) {
					set = new Set();
					handlers.set(channel, set);
				}
				set.add(handler);
				return () => {
					set.delete(handler);
				};
			},
			close() {},
		},
		push(channel, data) {
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
		subscriberCount() {
			let count = 0;
			for (const set of handlers.values()) count += set.size;
			return count;
		},
	};
}

function project(id: string): Project {
	return { id, name: id, path: `/repo/${id}` } as Project;
}

function welcome(projects: Project[]) {
	return { protocolVersion: 1, projects, recentProjects: projects };
}

test("switching to another host drops the previous host's state and stops its pushes", () => {
	const first = fakeHost();
	const second = fakeHost();

	const firstTransport = mountRemoteSession(first.client, "host-a");
	first.push(WS_CHANNELS.serverWelcome, welcome([project("a")]));
	expect(useAppStore.getState().projects.map((p) => p.id)).toEqual(["a"]);
	expect(firstTransport.backendKey()).toBe("remote:host-a");

	const generation = useAppStore.getState().connectionGeneration;
	const secondTransport = mountRemoteSession(second.client, "host-b");
	expect(first.subscriberCount()).toBe(0);
	expect(useAppStore.getState().projects).toEqual([]);
	expect(useAppStore.getState().connectionGeneration).toBeGreaterThan(generation);
	expect(secondTransport.backendKey()).toBe("remote:host-b");

	first.push(WS_CHANNELS.serverWelcome, welcome([project("stale")]));
	expect(useAppStore.getState().projects).toEqual([]);

	second.push(WS_CHANNELS.serverWelcome, welcome([project("b")]));
	expect(useAppStore.getState().projects.map((p) => p.id)).toEqual(["b"]);
});

test("host reset listeners run after the store reset, with writes during it flagged", () => {
	const seen: { resetting: boolean; projects: number }[] = [];
	const stopWatching = useAppStore.subscribe((state) => {
		if (isHostResetting()) seen.push({ resetting: true, projects: state.projects.length });
	});
	const stopReset = onHostReset(() => {
		seen.push({ resetting: isHostResetting(), projects: useAppStore.getState().projects.length });
	});
	const first = fakeHost();
	mountRemoteSession(first.client, "host-c");
	first.push(WS_CHANNELS.serverWelcome, welcome([project("c")]));
	seen.length = 0;

	mountRemoteSession(fakeHost().client, "host-d");
	stopWatching();
	stopReset();

	expect(seen).toEqual([
		{ resetting: true, projects: 0 },
		{ resetting: false, projects: 0 },
	]);
});

test("a welcome the device client replays on subscribe survives the mount", () => {
	const host = fakeHost();
	host.push(WS_CHANNELS.serverWelcome, welcome([project("early")]));
	const replaying: DeviceWireClient = {
		...host.client,
		subscribe(channel, handler) {
			const unsubscribe = host.client.subscribe(channel, handler);
			if (channel === WS_CHANNELS.serverWelcome) handler(welcome([project("replayed")]));
			return unsubscribe;
		},
	};
	mountRemoteSession(replaying, "host-e");
	expect(useAppStore.getState().protocolVersion).toBe(1);
	expect(useAppStore.getState().projects.map((p) => p.id)).toEqual(["replayed"]);
});
