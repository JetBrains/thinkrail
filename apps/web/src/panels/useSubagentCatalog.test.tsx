import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SubagentCatalogEntry } from "@thinkrail/contracts";
import { act, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { type AgentCatalog, useSubagentCatalog } from "./useSubagentCatalog";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };
beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
});
function headlessContainer() {
	const noop = () => {};
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
}
async function mount(node: ReactNode) {
	const root = createRoot(headlessContainer());
	await act(async () => root.render(node));
	return {
		rerender: (next: ReactNode) => act(async () => root.render(next)),
		unmount: () => act(async () => root.unmount()),
	};
}
const BUILTIN: SubagentCatalogEntry = {
	name: "worker",
	source: "builtin",
	description: "Implement work",
};
const PROJECT: SubagentCatalogEntry = {
	name: "private-project-role",
	source: "project",
	description: "Trusted only",
};
function host() {
	const pending: {
		workspaceId: string | undefined;
		resolve: (entries: SubagentCatalogEntry[]) => void;
		reject: () => void;
	}[] = [];
	const read = (workspaceId: string | undefined) =>
		new Promise<SubagentCatalogEntry[]>((resolve, reject) => {
			pending.push({ workspaceId, resolve, reject: () => reject(new Error("offline")) });
		});
	return { pending, read };
}
function Probe({
	workspaceId,
	trusted = true,
	generation = 1,
	read,
	changed,
}: {
	workspaceId?: string;
	trusted?: boolean;
	generation?: number;
	read: (workspaceId: string | undefined) => Promise<SubagentCatalogEntry[]>;
	changed: (catalog: AgentCatalog, refresh: () => void) => void;
}) {
	const { catalog, refresh } = useSubagentCatalog(workspaceId, trusted, generation, read);
	useEffect(() => {
		changed(catalog, refresh);
	}, [catalog, refresh, changed]);
	return null;
}
function observer() {
	const seen: AgentCatalog[] = [];
	let refresh = () => {};
	return {
		seen,
		changed: (catalog: AgentCatalog, nextRefresh: () => void) => {
			seen.push(catalog);
			refresh = nextRefresh;
		},
		refresh: () => act(async () => refresh()),
	};
}

test("workspace changes hide held rows immediately and discard stale successes and failures", async () => {
	const server = host();
	const obs = observer();
	const props = { read: server.read, changed: obs.changed };
	const view = await mount(<Probe workspaceId="a" {...props} />);
	await act(async () => server.pending[0]?.resolve([PROJECT]));
	expect(obs.seen.at(-1)).toEqual([PROJECT]);
	await obs.refresh();
	await view.rerender(<Probe workspaceId="b" {...props} />);
	expect(obs.seen.at(-1)).toBe("loading");
	await act(async () => server.pending[1]?.reject());
	expect(obs.seen.at(-1)).toBe("loading");
	await act(async () => server.pending[2]?.resolve([BUILTIN]));
	expect(obs.seen.at(-1)).toEqual([BUILTIN]);
	await view.unmount();
});

test("trust revocation clears project entries and ignores in-flight trusted reads", async () => {
	const server = host();
	const obs = observer();
	const props = { workspaceId: "a", read: server.read, changed: obs.changed };
	const view = await mount(<Probe {...props} />);
	await act(async () => server.pending[0]?.resolve([BUILTIN, PROJECT]));
	await obs.refresh();
	await view.rerender(<Probe {...props} trusted={false} />);
	expect(obs.seen.at(-1)).toBe("loading");
	await act(async () => server.pending[1]?.resolve([PROJECT]));
	expect(obs.seen.at(-1)).toBe("loading");
	await act(async () => server.pending[2]?.resolve([BUILTIN]));
	expect(obs.seen.at(-1)).toEqual([BUILTIN]);
	await view.unmount();
});

test("mount, reconnect and manual Refresh re-read; failed reads retry and no-workspace requests stay unscoped", async () => {
	const server = host();
	const obs = observer();
	const props = { read: server.read, changed: obs.changed, trusted: false };
	const view = await mount(<Probe {...props} />);
	expect(server.pending[0]?.workspaceId).toBeUndefined();
	await act(async () => server.pending[0]?.reject());
	expect(obs.seen.at(-1)).toBe("failed");
	await obs.refresh();
	expect(obs.seen.at(-1)).toBe("loading");
	await act(async () => server.pending[1]?.resolve([]));
	expect(obs.seen.at(-1)).toEqual([]);
	await view.rerender(<Probe {...props} generation={2} />);
	expect(obs.seen.at(-1)).toBe("loading");
	expect(server.pending).toHaveLength(3);
	await view.unmount();
	await act(async () => server.pending[2]?.resolve([BUILTIN]));
	const reopened = await mount(<Probe {...props} generation={2} />);
	expect(server.pending).toHaveLength(4);
	expect(obs.seen.at(-1)).toBe("loading");
	await reopened.unmount();
});
