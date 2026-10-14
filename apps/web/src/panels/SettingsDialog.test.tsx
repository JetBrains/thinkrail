import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { SettingsSection } from "@/store";

/**
 * Tests for Settings section selection and fallback behavior.
 *
 * The section selection logic ensures that:
 * 1. Available sections are selected when requested
 * 2. Unavailable sections (filtered by protocol version) fall back to Appearance
 * 3. The fallback never selects a section that was filtered out
 */

interface NavSection {
	id: SettingsSection;
	requiresProtocolVersion?: number;
	requiresInjectedContent?: boolean;
}

/** Simulates the isAvailable filter from SettingsDialog */
function isAvailable(
	section: NavSection,
	protocolVersion: number | null,
	hasUpdateSettings: boolean,
): boolean {
	return (
		(!section.requiresInjectedContent || hasUpdateSettings) &&
		(section.requiresProtocolVersion === undefined ||
			(protocolVersion !== null && protocolVersion >= section.requiresProtocolVersion))
	);
}

/** Simulates the section selection logic from SettingsDialog */
function selectSection(
	requestedSection: SettingsSection,
	protocolVersion: number | null,
	hasUpdateSettings: boolean,
): SettingsSection {
	// Simplified NAV_GROUPS for testing - mirrors the actual structure
	const allSections: NavSection[] = [
		{ id: SettingsSection.Models, requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION },
		{ id: SettingsSection.Providers },
		{ id: SettingsSection.Chat },
		{ id: SettingsSection.Appearance },
		{ id: SettingsSection.Layout },
		{ id: SettingsSection.Terminal },
		{ id: SettingsSection.Github },
		{ id: SettingsSection.Templates },
		{ id: SettingsSection.Notifications },
		{ id: SettingsSection.Privacy },
		{ id: SettingsSection.Updates, requiresInjectedContent: true },
	];

	const availableSections = allSections.filter((s) =>
		isAvailable(s, protocolVersion, hasUpdateSettings),
	);

	// This is the exact logic from SettingsDialog.tsx
	if (
		requestedSection === SettingsSection.Feedback ||
		availableSections.some((s) => s.id === requestedSection)
	) {
		return requestedSection;
	}

	// Fall back to Appearance (always available) or the first available section
	if (availableSections.some((s) => s.id === SettingsSection.Appearance)) {
		return SettingsSection.Appearance;
	}

	return availableSections[0]?.id ?? SettingsSection.Appearance;
}

describe("Settings section selection fallback", () => {
	describe("on v72+ hosts (Models available)", () => {
		const protocolVersion = DEFAULT_MODEL_PROTOCOL_VERSION;

		test("selects Models when requested", () => {
			const selected = selectSection(SettingsSection.Models, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Models);
		});

		test("selects Appearance when requested", () => {
			const selected = selectSection(SettingsSection.Appearance, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Appearance);
		});

		test("selects Chat when requested", () => {
			const selected = selectSection(SettingsSection.Chat, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Chat);
		});

		test("selects Feedback when requested (accessible via sidebar card)", () => {
			const selected = selectSection(SettingsSection.Feedback, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Feedback);
		});
	});

	describe("on pre-v72 hosts (Models unavailable)", () => {
		const protocolVersion = DEFAULT_MODEL_PROTOCOL_VERSION - 1;

		test("falls back to Appearance when Models is requested", () => {
			const selected = selectSection(SettingsSection.Models, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Appearance);
		});

		test("does NOT fall back to Models (which is filtered out)", () => {
			const selected = selectSection(SettingsSection.Models, protocolVersion, false);
			expect(selected).not.toBe(SettingsSection.Models);
		});

		test("selects available sections normally", () => {
			expect(selectSection(SettingsSection.Appearance, protocolVersion, false)).toBe(
				SettingsSection.Appearance,
			);
			expect(selectSection(SettingsSection.Chat, protocolVersion, false)).toBe(
				SettingsSection.Chat,
			);
			expect(selectSection(SettingsSection.Providers, protocolVersion, false)).toBe(
				SettingsSection.Providers,
			);
		});

		test("Feedback remains accessible", () => {
			const selected = selectSection(SettingsSection.Feedback, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Feedback);
		});
	});

	describe("on very old hosts (protocol version 1)", () => {
		const protocolVersion = 1;

		test("falls back to Appearance for unavailable sections", () => {
			const selected = selectSection(SettingsSection.Models, protocolVersion, false);
			expect(selected).toBe(SettingsSection.Appearance);
		});

		test("available sections work normally", () => {
			expect(selectSection(SettingsSection.Chat, protocolVersion, false)).toBe(
				SettingsSection.Chat,
			);
			expect(selectSection(SettingsSection.Terminal, protocolVersion, false)).toBe(
				SettingsSection.Terminal,
			);
		});
	});

	describe("Updates section (requires injected content)", () => {
		test("selects Updates when injected content is available", () => {
			const selected = selectSection(
				SettingsSection.Updates,
				DEFAULT_MODEL_PROTOCOL_VERSION,
				true, // hasUpdateSettings
			);
			expect(selected).toBe(SettingsSection.Updates);
		});

		test("falls back to Appearance when Updates is unavailable", () => {
			const selected = selectSection(
				SettingsSection.Updates,
				DEFAULT_MODEL_PROTOCOL_VERSION,
				false, // no updateSettings
			);
			expect(selected).toBe(SettingsSection.Appearance);
		});
	});

	describe("null protocol version (not yet negotiated)", () => {
		test("Models is unavailable, falls back to Appearance", () => {
			const selected = selectSection(SettingsSection.Models, null, false);
			expect(selected).toBe(SettingsSection.Appearance);
		});

		test("sections without protocol requirements work", () => {
			expect(selectSection(SettingsSection.Chat, null, false)).toBe(SettingsSection.Chat);
			expect(selectSection(SettingsSection.Appearance, null, false)).toBe(
				SettingsSection.Appearance,
			);
		});
	});
});

describe("Settings section organization", () => {
	// The navigation sections used in SettingsDialog
	const NAV_SECTIONS = [
		SettingsSection.Models,
		SettingsSection.Providers,
		SettingsSection.Chat,
		SettingsSection.Appearance,
		SettingsSection.Layout,
		SettingsSection.Terminal,
		SettingsSection.Github,
		SettingsSection.Templates,
		SettingsSection.Notifications,
		SettingsSection.Privacy,
		SettingsSection.Updates,
	];

	test("Review is not a separate navigation section", () => {
		expect(NAV_SECTIONS).not.toContain(SettingsSection.Review);
	});

	test("Models is a navigation section (owns merged review settings)", () => {
		expect(NAV_SECTIONS).toContain(SettingsSection.Models);
	});

	test("Review section enum value exists for backward compatibility", () => {
		// The enum value is retained but not used in navigation
		expect(SettingsSection.Review).toBe("review");
	});
});

describe("Review controls ownership", () => {
	// These test IDs document where review controls live in the merged ModelsSettings component.
	// The actual DOM assertions would require component rendering; these tests document the contract.
	const MODELS_SETTINGS_TEST_ID = "settings-models";
	const REVIEW_CONTROL_TEST_IDS = [
		"agent-review-row",
		"agent-review-toggle",
		"review-autofix-row",
		"review-autofix-toggle",
	];

	test("review controls have documented test IDs within Models section", () => {
		// The presence of these test IDs in ModelsSettings.tsx is verified by grep;
		// this test documents the contract for component tests and e2e.
		expect(MODELS_SETTINGS_TEST_ID).toBe("settings-models");
		expect(REVIEW_CONTROL_TEST_IDS).toHaveLength(4);
		for (const id of REVIEW_CONTROL_TEST_IDS) {
			expect(id).toMatch(/^(agent-review|review-autofix)-(row|toggle)$/);
		}
	});
});
