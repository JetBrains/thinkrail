import { describe, expect, it, mock } from "bun:test";
import { isAbsolute } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { defineServerExtension, type ServerExtension } from "@thinkrail/extension-api/server";

describe("defineServerExtension", () => {
	it("preserves ordered factories and skill specifiers without loading them", () => {
		const first = mock<ExtensionFactory>(() => {});
		const second = mock<ExtensionFactory>(async () => {});
		const child = mock<ExtensionFactory>(() => {});
		const descriptor = {
			name: "example",
			extensions: [first, second],
			childExtensions: [child],
			skillPackages: ["@example/skills", "another-skill-package"],
		} satisfies ServerExtension;
		const extension = defineServerExtension(descriptor);

		expect(extension).toBe(descriptor);
		expect(extension.extensions).toBe(descriptor.extensions);
		expect(extension.extensions).toEqual([first, second]);
		expect(extension.childExtensions).toBe(descriptor.childExtensions);
		expect(extension.skillPackages).toBe(descriptor.skillPackages);
		expect(first).not.toHaveBeenCalled();
		expect(second).not.toHaveBeenCalled();
		expect(child).not.toHaveBeenCalled();
	});

	it("does not synthesize omitted child factories or skill packages", () => {
		const descriptor = { name: "minimal", extensions: [] } satisfies ServerExtension;
		const extension = defineServerExtension(descriptor);

		expect(extension).toBe(descriptor);
		expect(extension).not.toHaveProperty("childExtensions");
		expect(extension).not.toHaveProperty("skillPackages");
		expect(extension).not.toHaveProperty("title");
		expect(extension).not.toHaveProperty("description");
	});

	it("keeps display copy beside the identity", () => {
		const extension = defineServerExtension({
			name: "shown",
			title: "Shown",
			description: "Shows up in Settings.",
			extensions: [],
		});

		expect(extension.name).toBe("shown");
		expect(extension.title).toBe("Shown");
		expect(extension.description).toBe("Shows up in Settings.");
	});

	it("erases the pi type dependency from its runtime entry", async () => {
		const imports: string[] = [];
		const build = await Bun.build({
			entrypoints: [Bun.resolveSync("@thinkrail/extension-api/server", import.meta.dir)],
			target: "browser",
			plugins: [
				{
					name: "record-runtime-imports",
					setup(builder) {
						builder.onResolve({ filter: /^[^./]/ }, ({ path }) => {
							if (isAbsolute(path)) return undefined;
							imports.push(path);
							return undefined;
						});
					},
				},
			],
		});

		expect(build.success).toBe(true);
		expect(imports).toEqual([]);
		expect(await build.outputs[0]?.text()).toContain("defineServerExtension");
	});
});
