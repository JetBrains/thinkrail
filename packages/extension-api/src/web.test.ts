import { describe, expect, it, mock } from "bun:test";
import {
	defineWebExtension,
	type GlobalOverlayProps,
	type PanelDeclaration,
	type PanelHost,
	type PanelPeekEntry,
	type PanelProps,
	type SideToolDeclaration,
	type StatusItemDeclaration,
	type StatusItemProps,
	type ToolRegistrationOptions,
	type ToolRenderProps,
	type ViewDeclaration,
	type WebExtension,
} from "@thinkrail/extension-api/web";

const props: ToolRenderProps = {
	toolCallId: "example-call",
	toolName: "example",
	args: { path: "src/example.ts" },
	result: undefined,
	status: "running",
	streaming: true,
};

describe("defineWebExtension", () => {
	it("preserves the descriptor, renderer and metadata without registering or invoking anything", () => {
		const renderer = mock((_props: ToolRenderProps) => null);
		const summary = mock(({ toolName }: ToolRenderProps) => toolName);
		const options: ToolRegistrationOptions = {
			summary,
			chrome: "bare",
			prominence: "primary",
			width: "content",
			defaultExpanded: true,
			interactive: true,
			dock: true,
			composerSuggestions: () => ["Run the tests"],
		};
		const descriptor = {
			name: "example",
			toolRenderers: { example: { renderer, options } },
		} satisfies WebExtension;
		const extension = defineWebExtension(descriptor);

		expect(extension).toBe(descriptor);
		expect(extension.toolRenderers).toBe(descriptor.toolRenderers);
		expect(extension.toolRenderers.example.renderer).toBe(renderer);
		expect(extension.toolRenderers.example.options).toBe(options);
		expect(renderer).not.toHaveBeenCalled();
		expect(summary).not.toHaveBeenCalled();
	});

	it("contextually types renderer props and summaries and leaves optional metadata absent", () => {
		const extension = defineWebExtension({
			name: "minimal",
			toolRenderers: {
				plain: { renderer: ({ toolName }) => toolName },
				file: {
					renderer: ({ onOpenFile }) => {
						onOpenFile?.("src/example.ts");
						return null;
					},
					options: { summary: ({ status }) => status },
				},
			},
		});
		const onOpenFile = mock((_path: string) => {});

		expect(extension.toolRenderers.plain.renderer(props)).toBe("example");
		expect(extension.toolRenderers.plain).not.toHaveProperty("options");
		expect(extension.toolRenderers.file.renderer({ ...props, onOpenFile })).toBeNull();
		expect(onOpenFile).toHaveBeenCalledWith("src/example.ts");
		expect(extension.toolRenderers.file.options.summary(props)).toBe("running");
		expect(defineWebExtension({ name: "empty", toolRenderers: {} }).toolRenderers).toEqual({});
		expect(defineWebExtension({ name: "empty", toolRenderers: {} })).not.toHaveProperty("panels");
	});

	it("preserves panel declarations without loading their components", async () => {
		const Panel = ({ params }: PanelProps) => params.view ?? null;
		const load = mock(async () => ({ default: Panel }));
		const icon = () => null;
		const declaration: PanelDeclaration = {
			title: "common.retry",
			icon,
			scopes: ["project"],
			load,
		};
		const extension = defineWebExtension({ name: "panels", panels: { overview: declaration } });

		expect(extension.panels.overview).toBe(declaration);
		expect(load).not.toHaveBeenCalled();
		expect((await extension.panels.overview.load()).default).toBe(Panel);
	});

	it("preserves a panel's chat action and rail entry, with the rail's command among the extension's own", () => {
		const params = mock(({ sessionId }: { sessionId: string }) => ({ sessionId }));
		const load = async () => ({ default: () => null });
		const open = {
			id: "panels.openList",
			title: "common.retry",
			chords: [{ code: "KeyI", key: "I", ctrl: true, alt: true }],
		} as const;
		const descriptor = {
			name: "panels",
			commands: [open],
			panels: {
				list: {
					title: "common.retry",
					icon: () => null,
					scopes: ["project"],
					rail: { command: open.id },
					load,
				},
				chat: {
					title: "common.retry",
					icon: () => null,
					scopes: ["session"],
					chatAction: { menuLabel: "common.close", params },
					load,
				},
			},
		} satisfies WebExtension;
		const extension = defineWebExtension(descriptor);
		const chat = { projectId: "p", workspaceId: "w", sessionId: "s" };

		expect(extension).toBe(descriptor);
		expect(extension.panels.list.rail).toEqual({ command: "panels.openList" });
		expect(extension.panels.list.rail).not.toHaveProperty("label");
		expect(extension.commands.map(({ id }) => id)).toContain(extension.panels.list.rail.command);
		expect(extension.panels.chat.chatAction).not.toHaveProperty("label");
		expect(params).not.toHaveBeenCalled();
		expect(extension.panels.chat.chatAction.params(chat)).toEqual({ sessionId: "s" });
		expect(extension.panels.list).not.toHaveProperty("chatAction");
	});
});

describe("side tools and the panel host's workspace, Peek and event seams", () => {
	it("preserves side tool declarations without loading their bodies", async () => {
		const Board = ({ host }: PanelProps) => host.scope.projectId;
		const load = mock(async () => ({ default: Board }));
		const board: SideToolDeclaration = {
			title: "common.retry",
			icon: () => null,
			defaultSide: "left",
			load,
		};
		const extension = defineWebExtension({ name: "board", sideTools: { board } });

		expect(extension.sideTools.board).toBe(board);
		expect(extension).not.toHaveProperty("panels");
		expect(load).not.toHaveBeenCalled();
		expect((await extension.sideTools.board.load()).default).toBe(Board);
	});

	it("types openWorkspace, peek entries and onEvent's unsubscribe for a panel", () => {
		const peeked: PanelPeekEntry[] = [];
		const opened: unknown[] = [];
		const listeners = new Set<(payload: unknown) => void>();
		const host: Pick<PanelHost, "openWorkspace" | "peek" | "onEvent"> = {
			openWorkspace: (target) => opened.push(target),
			peek: (entry) => peeked.push(entry),
			onEvent: (_type, listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		host.openWorkspace({ workspaceId: "w", projectId: "p", sessionId: "s" });
		host.peek({ kind: "extension", panel: "card", params: { cardId: "TR-1" }, title: "TR-1" });
		host.peek({ kind: "file", path: "src/a.ts", line: 3 });
		host.peek({ kind: "compare", before: "a.md", after: "b.md" });
		const unsubscribe = host.onEvent("board.changed", () => {});

		expect(opened).toEqual([{ workspaceId: "w", projectId: "p", sessionId: "s" }]);
		expect(peeked.map((entry) => entry.kind)).toEqual(["extension", "file", "compare"]);
		expect(listeners.size).toBe(1);
		unsubscribe();
		expect(listeners.size).toBe(0);
	});

	it("preserves status items without loading them, and views naming their panel and side tools", async () => {
		const Inbox = ({ host }: StatusItemProps) => host.scope?.projectId ?? null;
		const load = mock(async () => ({ default: Inbox }));
		const inbox: StatusItemDeclaration = { load };
		const view: ViewDeclaration = {
			title: "common.retry",
			icon: () => null,
			center: "main",
			left: "nav",
			bottom: "activity",
			layout: { leftWidth: 0.18, bottomHeight: 0.26 },
		};
		const extension = defineWebExtension({
			name: "board",
			statusItems: { inbox },
			views: { board: view },
		});

		expect(extension.statusItems.inbox).toBe(inbox);
		expect(extension.views.board).toBe(view);
		expect(extension.views.board).not.toHaveProperty("peekEmpty");
		expect(extension).not.toHaveProperty("sideTools");
		expect(load).not.toHaveBeenCalled();
		expect((await extension.statusItems.inbox.load()).default).toBe(Inbox);
	});
});

describe("web-only contribution points", () => {
	it("preserves display copy, a global overlay, commands and shortcut rows, with no tool renderers", () => {
		const overlay = mock((_props: GlobalOverlayProps) => null);
		const descriptor = {
			name: "keyboard-aid",
			title: "hintMode.title",
			description: "hintMode.description",
			globalOverlay: overlay,
			commands: [
				{
					id: "keyboard-aid.show",
					title: "hintMode.shortcuts.show",
					chords: [
						{ code: "KeyF", key: "f" },
						{ code: "Semicolon", key: ";", mod: true },
					],
				},
				{
					id: "keyboard-aid.pin",
					title: "hintMode.shortcuts.show",
					scope: "keyboard-aid.panel",
					chords: [{ code: "KeyP", key: "p" }],
				},
			],
			shortcuts: [
				{
					id: "keyboard-aid.exit",
					title: "hintMode.shortcuts.exit",
					keys: [{ code: "Escape", key: "Escape" }],
				},
			],
		} satisfies WebExtension;
		const extension = defineWebExtension(descriptor);

		expect(extension).toBe(descriptor);
		expect(extension).not.toHaveProperty("toolRenderers");
		expect(extension.globalOverlay).toBe(overlay);
		expect(extension.commands[0]?.chords[1]).toEqual({ code: "Semicolon", key: ";", mod: true });
		expect(extension.commands[1]?.scope).toBe("keyboard-aid.panel");
		expect(extension.shortcuts[0]?.keys[0]).toEqual({ code: "Escape", key: "Escape" });
		expect(overlay).not.toHaveBeenCalled();
	});
});
