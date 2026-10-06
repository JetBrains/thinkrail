import { describe, expect, it, mock } from "bun:test";
import {
	defineWebExtension,
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
			defaultExpanded: true,
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
	});
});
