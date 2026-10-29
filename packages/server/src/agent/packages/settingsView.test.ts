import { describe, expect, it } from "bun:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { withoutPackages, withPackageDeclarations } from "./settingsView";

describe("withPackageDeclarations", () => {
	it("hides the declarations the filter rejects from both scopes and leaves the rest alone", () => {
		const settings = SettingsManager.inMemory({
			packages: ["npm:keep", { source: "npm:drop", extensions: [] }],
			extensions: ["+builtin:mcp"],
		});
		const view = withPackageDeclarations(settings, (declaration, scope) => {
			const source = typeof declaration === "string" ? declaration : declaration.source;
			return scope === "user" && source !== "npm:drop";
		});
		expect(view).toBe(settings);
		expect(view.getGlobalSettings().packages).toEqual(["npm:keep"]);
		expect(view.getGlobalSettings().extensions).toEqual(["+builtin:mcp"]);
		expect(view.getProjectSettings().packages).toBeUndefined();
	});

	it("patches an instance once: a later view does not replace the first", () => {
		const settings = SettingsManager.inMemory({ packages: ["npm:keep"] });
		withPackageDeclarations(settings, () => true);
		withoutPackages(settings);
		expect(settings.getGlobalSettings().packages).toEqual(["npm:keep"]);
	});

	it("withoutPackages hides every declaration", () => {
		const settings = withoutPackages(SettingsManager.inMemory({ packages: ["npm:a", "./b"] }));
		expect(settings.getGlobalSettings().packages).toEqual([]);
	});
});
