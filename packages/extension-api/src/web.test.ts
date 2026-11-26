import { describe, expect, it, mock } from "bun:test";
import {
	defineWebExtension,
	type GlobalOverlayProps,
	type PanelDeclaration,
	type PanelProps,
	type ToolRegistrationOptions,
	type ToolRenderProps,
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
