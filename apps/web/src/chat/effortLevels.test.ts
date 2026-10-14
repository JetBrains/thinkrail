import { describe, expect, test } from "bun:test";
import type { ThinkingLevel } from "@thinkrail/contracts";
import { effortDescription, effortLabel } from "./ModelEffortPicker";

describe("effortLabel", () => {
	test("maps known levels to compact labels", () => {
		expect(effortLabel("off")).toBe("Off");
		expect(effortLabel("minimal")).toBe("Min");
		expect(effortLabel("low")).toBe("Low");
		expect(effortLabel("medium")).toBe("Med");
		expect(effortLabel("high")).toBe("High");
	});

	test("maps xhigh and max levels", () => {
		expect(effortLabel("xhigh")).toBe("XHigh");
		expect(effortLabel("max")).toBe("Max");
	});

	test("provides readable fallback for unknown levels", () => {
		// Cast to ThinkingLevel to test unknown value handling
		expect(effortLabel("ultra" as ThinkingLevel)).toBe("Ultra");
		expect(effortLabel("extreme" as ThinkingLevel)).toBe("Extreme");
		expect(effortLabel("turbo" as ThinkingLevel)).toBe("Turbo");
	});
});

describe("effortDescription", () => {
	test("returns known descriptions for standard levels", () => {
		expect(effortDescription("off")).toBe("No reasoning · Fastest · Cheapest");
		expect(effortDescription("minimal")).toBe("Briefest reasoning");
		expect(effortDescription("low")).toBe("Light reasoning");
		expect(effortDescription("medium")).toBe("Balanced reasoning");
		expect(effortDescription("high")).toBe("Deep reasoning");
	});

	test("returns descriptions for xhigh and max", () => {
		expect(effortDescription("xhigh")).toBe("Extended reasoning");
		expect(effortDescription("max")).toBe("Maximum reasoning");
	});

	test("provides readable fallback for unknown levels", () => {
		expect(effortDescription("ultra" as ThinkingLevel)).toBe("Ultra reasoning");
		expect(effortDescription("extreme" as ThinkingLevel)).toBe("Extreme reasoning");
	});
});

describe("effort level rendering", () => {
	test("model with all standard levels renders them in order", () => {
		const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
		const labels = levels.map(effortLabel);
		expect(labels).toEqual(["Off", "Min", "Low", "Med", "High"]);
	});

	test("model with extended levels includes xhigh and max", () => {
		const levels: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
		const labels = levels.map(effortLabel);
		expect(labels).toEqual(["Min", "Low", "Med", "High", "XHigh", "Max"]);
	});

	test("model without off does not include Off", () => {
		const levels: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
		const labels = levels.map(effortLabel);
		expect(labels).not.toContain("Off");
		expect(labels).toEqual(["Min", "Low", "Med", "High"]);
	});

	test("preserves model-provided level order", () => {
		// Unusual order - should be preserved
		const levels: ThinkingLevel[] = ["high", "medium", "low"];
		const labels = levels.map(effortLabel);
		expect(labels).toEqual(["High", "Med", "Low"]);
	});

	test("handles model with only xhigh and max", () => {
		const levels: ThinkingLevel[] = ["xhigh", "max"];
		const labels = levels.map(effortLabel);
		expect(labels).toEqual(["XHigh", "Max"]);
	});

	test("handles future unknown levels gracefully", () => {
		const levels = ["turbo", "quantum", "neural"] as ThinkingLevel[];
		const labels = levels.map(effortLabel);
		expect(labels).toEqual(["Turbo", "Quantum", "Neural"]);
	});
});
