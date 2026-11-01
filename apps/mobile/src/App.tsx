import { App as CapApp } from "@capacitor/app";
import {
	connectRemoteProject,
	createHostRegistry,
	createRemoteSessions,
	type RemoteSessionItem,
	type SavedHost,
} from "@thinkrail/remote-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PairForm } from "./PairForm";
import { SessionList } from "./SessionList";
import { type OpenSession, SessionScreen } from "./SessionScreen";
import { isPairLink } from "./scanPairLink";
import { localStore } from "./store";
import { Welcome } from "./Welcome";

const DEVICE_LABEL = "Mobile";

export type PairState = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; reason: string };

const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export function App() {
	const registry = useMemo(() => createHostRegistry(localStore), []);
	const controller = useMemo(() => createRemoteSessions(), []);
	const [hosts, setHosts] = useState<SavedHost[]>(() => registry.list());
	const [items, setItems] = useState<RemoteSessionItem[]>([]);
	const [pair, setPair] = useState<PairState>({ kind: "idle" });
	const [adding, setAdding] = useState(false);
	const [open, setOpen] = useState<OpenSession | null>(null);
	const [unreachable, setUnreachable] = useState<ReadonlySet<string>>(() => new Set());
	const markReachable = useCallback((label: string, reachable: boolean) => {
		setUnreachable((current) => {
			if (current.has(label) !== reachable) return current;
			const next = new Set(current);
			if (reachable) next.delete(label);
			else next.add(label);
			return next;
		});
	}, []);

	const pairWith = useCallback(
		async (link: string): Promise<boolean> => {
			setPair({ kind: "pairing" });
			try {
				const connection = await connectRemoteProject(link, { label: DEVICE_LABEL });
				const host: SavedHost = {
					hostKey: connection.hostKey,
					relayUrl: connection.relayUrl,
					label: new URL(connection.relayUrl).host,
					pairedAt: Date.now(),
				};
				connection.close();
				setHosts(registry.add(host));
				await controller.connect(host);
				markReachable(host.label, true);
				setPair({ kind: "idle" });
				setAdding(false);
				return true;
			} catch (error) {
				setPair({ kind: "failed", reason: reasonOf(error) });
				return false;
			}
		},
		[controller, registry, markReachable],
	);

	useEffect(() => {
		const unsubscribe = controller.subscribe(() => setItems(controller.items()));
		for (const host of registry.list()) {
			void controller
				.connect(host)
				.then(() => markReachable(host.label, true))
				.catch(() => markReachable(host.label, false));
		}
		const onLink = (url: string | undefined): void => {
			if (isPairLink(url)) void pairWith(url.trim());
		};
		void CapApp.getLaunchUrl()
			.then((launch) => onLink(launch?.url))
			.catch(() => {});
		const deepLink = CapApp.addListener("appUrlOpen", (event) => onLink(event.url));
		return () => {
			unsubscribe();
			void deepLink.then((handle) => handle.remove());
			controller.stop();
		};
	}, [controller, registry, pairWith, markReachable]);

	if (open) {
		return <SessionScreen session={open} controller={controller} onBack={() => setOpen(null)} />;
	}
	if (hosts.length === 0) {
		return <Welcome pair={pair} onPair={pairWith} />;
	}
	return (
		<SessionList
			items={items}
			unreachable={[...unreachable]}
			onOpen={setOpen}
			adding={adding}
			onAdd={() => setAdding(true)}
			pairForm={<PairForm pair={pair} onPair={pairWith} onCancel={() => setAdding(false)} />}
		/>
	);
}
