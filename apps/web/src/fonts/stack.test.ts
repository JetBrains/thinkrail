import { expect, test } from "bun:test";
import {
	familiesOf,
	fontStack,
	namedFamilies,
	previewStack,
	quoteFamily,
	refFamily,
	roleFamily,
} from "./stack";

const faces = { interface: "Geist Variable", code: "JetBrains Mono Variable" };

test("the role default with no fallbacks leaves the generated token alone", () => {
	expect(fontStack({ family: null, fallbacks: [] }, "code", faces)).toBeNull();
});

test("a chosen family and its fallbacks precede the bundled stack", () => {
	expect(
		fontStack(
			{ family: { name: "Fira Code" }, fallbacks: [{ name: "MesloLGS NF" }] },
			"code",
			faces,
		),
	).toBe('"Fira Code", "MesloLGS NF", var(--tr-font-family-code-default)');
});

test("fallbacks on the default face keep the bundled face first", () => {
	expect(fontStack({ family: null, fallbacks: [{ name: "MesloLGS NF" }] }, "code", faces)).toBe(
		'"JetBrains Mono Variable", "MesloLGS NF", var(--tr-font-family-code-default)',
	);
});

test("a bundled face can serve the other role, and duplicates collapse", () => {
	expect(
		fontStack(
			{ family: { builtin: "code" }, fallbacks: [{ builtin: "code" }, { name: "Inter" }] },
			"interface",
			faces,
		),
	).toBe('"JetBrains Mono Variable", "Inter", var(--tr-font-family-interface-default)');
});

test("an unresolved bundled face is skipped rather than written as an empty family", () => {
	expect(
		fontStack({ family: null, fallbacks: [{ name: "Inter" }] }, "interface", {
			interface: "",
			code: "",
		}),
	).toBe('"Inter", var(--tr-font-family-interface-default)');
});

test("generic families stay unquoted and computed stacks parse back to names", () => {
	expect(quoteFamily("monospace")).toBe("monospace");
	expect(quoteFamily("Fira Code")).toBe('"Fira Code"');
	expect(familiesOf('"Geist Variable", Geist, -apple-system, sans-serif')).toEqual([
		"Geist Variable",
		"Geist",
		"-apple-system",
		"sans-serif",
	]);
	expect(previewStack("Fira Code", "code")).toBe('"Fira Code", var(--tr-font-family-code-default)');
});

test("refs resolve to family names, the role default standing in for no choice", () => {
	expect(roleFamily(null, "code", faces)).toBe(faces.code);
	expect(roleFamily({ builtin: "interface" }, "code", faces)).toBe(faces.interface);
	expect(roleFamily({ name: "Fira Code" }, "code", faces)).toBe("Fira Code");
	expect(refFamily({ builtin: "code" }, faces)).toBe(faces.code);
});

test("named families gather every chosen and fallback name, never a bundled ref", () => {
	const named = namedFamilies([
		{ family: { name: "Fira Code" }, fallbacks: [{ builtin: "code" }, { name: "Noto Emoji" }] },
		{ family: null, fallbacks: [{ name: "Fira Code" }] },
	]);
	expect([...named]).toEqual(["Fira Code", "Noto Emoji"]);
});
