import {
	EXT_PROTOCOL_VERSION,
	type ExtChannelPush,
	type ExtChannelsDroppedPush,
	type ExtensionInfo,
	type ExtRemovedPush,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { useExtStore } from "./extStore";
import { syncRendererSlots } from "./rendererSlots";

export const supportsExtensions = (protocolVersion: number | null) =>
	protocolVersion !== null && protocolVersion >= EXT_PROTOCOL_VERSION;

export type SyncTransport = Pick<ReturnType<typeof getTransport>, "subscribe" | "request">;

let initialized = false;

export const initExtensions = () => {
	if (initialized) return;
	initialized = true;
	startExtensionSync(getTransport());
};

export const startExtensionSync = (transport: SyncTransport) => {
	const ext = () => useExtStore.getState();
	let generation = 0;
	let buffered: (() => void)[] | null = null;
	const route = (apply: () => void) => {
		if (buffered) buffered.push(apply);
		else apply();
	};
	const settle = (current: number, install?: () => void) => {
		if (current !== generation) return;
		const pending = buffered ?? [];
		buffered = null;
		install?.();
		for (const apply of pending) apply();
	};

	const unsubscribes = [
		transport.subscribe(WS_CHANNELS.extChanged, (data) =>
			route(() => ext().applyChanged(data as ExtensionInfo)),
		),
		transport.subscribe(WS_CHANNELS.extRemoved, (data) =>
			route(() => ext().applyRemoved((data as ExtRemovedPush).name)),
		),
		transport.subscribe(WS_CHANNELS.extChannel, (data) => {
			const { key, value } = data as ExtChannelPush;
			route(() => ext().applyChannel(key, value));
		}),
		transport.subscribe(WS_CHANNELS.extChannelsDropped, (data) =>
			route(() => ext().dropChannels((data as ExtChannelsDroppedPush).keys)),
		),
	];

	const hydrate = () => {
		const current = ++generation;
		if (!supportsExtensions(useAppStore.getState().protocolVersion)) {
			buffered = null;
			ext().markUnsupported();
			return;
		}
		buffered = [];
		Promise.all([transport.request("ext.list", {}), transport.request("ext.snapshot", {})])
			.then(([list, snapshot]) => settle(current, () => ext().install(list, snapshot)))
			.catch(() => settle(current));
	};

	const stopWelcome = useAppStore.subscribe((state, previous) => {
		if (state.welcomeGeneration !== previous.welcomeGeneration) hydrate();
	});
	const stopRenderers = useExtStore.subscribe((state, previous) => {
		if (state.extensions !== previous.extensions) syncRendererSlots(state.extensions);
	});
	return () => {
		for (const unsubscribe of unsubscribes) unsubscribe();
		stopWelcome();
		stopRenderers();
	};
};
